import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { local, storageDriver } from "@/lib/graph/storage";

export async function GET(_req: Request, ctx: RouteContext<"/api/storage/local/item/[id]">) {
  if (storageDriver() !== "local") return new NextResponse("Not found", { status: 404 });
  if (!(await auth())?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  try {
    const { file, item } = await local.blobPath(id);
    return new NextResponse(new Uint8Array(await fs.readFile(file)), {
      headers: {
        "Content-Type": item.mime ?? "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(item.name)}`,
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
