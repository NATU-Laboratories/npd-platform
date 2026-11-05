import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { replenishmentFiles } from "@/db/schema";
import { getStorage } from "@/lib/graph/storage";
import { getCurrentUser, isActive } from "@/lib/server/authz";
import { logError } from "@/lib/server/errors";
import { canAccessReplenishments } from "@/lib/server/replenishments";

/** Descarga de un archivo de una reposición (comprueba el acceso al apartado). */
export async function GET(req: Request, ctx: RouteContext<"/api/rep-files/[id]">) {
  const u = await getCurrentUser();
  if (!u || !isActive(u)) return new NextResponse("Unauthorized", { status: 401 });
  if (!canAccessReplenishments(u)) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  const [row] = await db.select({ itemId: replenishmentFiles.storageItemId, url: replenishmentFiles.url }).from(replenishmentFiles).where(eq(replenishmentFiles.id, Number(id)));
  if (!row) return new NextResponse("Not found", { status: 404 });
  if (row.url) return NextResponse.redirect(row.url, 302);
  try {
    const url = await getStorage().downloadUrl(row.itemId);
    return NextResponse.redirect(new URL(url, req.url), 302);
  } catch (err) {
    await logError("rep-files:download", err, { fileId: id });
    return new NextResponse("No se pudo obtener el archivo", { status: 502 });
  }
}
