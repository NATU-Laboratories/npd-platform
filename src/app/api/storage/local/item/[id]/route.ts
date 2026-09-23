import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { chunkStore } from "@/lib/graph/storage";

export async function GET(_req: Request, ctx: RouteContext<"/api/storage/local/item/[id]">) {
  const store = chunkStore();
  if (!store) return new NextResponse("Not found", { status: 404 });
  if (!(await auth())?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  try {
    const { data, item } = await store.read(id);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": item.mime ?? "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(item.name)}`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
