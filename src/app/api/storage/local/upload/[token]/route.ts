import { NextResponse } from "next/server";
import { chunkStore } from "@/lib/graph/storage";
import { GraphError } from "@/lib/graph/client";

/** Emula la upload session de Graph para el almacenamiento local / en BD. */
export async function PUT(req: Request, ctx: RouteContext<"/api/storage/local/upload/[token]">) {
  const store = chunkStore();
  if (!store) return new NextResponse("Not found", { status: 404 });
  const { token } = await ctx.params;
  try {
    const body = Buffer.from(await req.arrayBuffer());
    const res = await store.receiveChunk(token, req.headers.get("content-range"), body, req.headers.get("x-file-type"));
    if ("nextExpectedRanges" in res) return NextResponse.json(res, { status: 202 });
    return NextResponse.json({ id: res.id, name: res.name, size: res.size, file: { mimeType: res.mime } }, { status: 201 });
  } catch (err) {
    const status = err instanceof GraphError ? err.status : 500;
    return NextResponse.json({ error: String(err) }, { status });
  }
}
