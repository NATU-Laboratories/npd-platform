import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { files, projects } from "@/db/schema";
import { getStorage } from "@/lib/graph/storage";
import { canViewProject, getCurrentUser, isActive } from "@/lib/server/authz";
import { logError } from "@/lib/server/errors";

/** Descarga/visualización: comprueba permisos y redirige a la URL temporal de Graph. */
export async function GET(req: Request, ctx: RouteContext<"/api/files/[id]">) {
  const u = await getCurrentUser();
  if (!u || !isActive(u)) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const [row] = await db
    .select({ itemId: files.sharepointItemId, projectId: files.projectId, status: projects.status, requesterId: projects.requesterId })
    .from(files)
    .innerJoin(projects, eq(projects.id, files.projectId))
    .where(eq(files.id, Number(id)));
  if (!row) return new NextResponse("Not found", { status: 404 });
  const allowed = row.status === "draft" ? row.requesterId === u.id : await canViewProject(u, row.projectId);
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });
  try {
    const url = await getStorage().downloadUrl(row.itemId);
    return NextResponse.redirect(new URL(url, req.url), 302);
  } catch (err) {
    await logError("files:download", err, { fileId: id });
    return new NextResponse("No se pudo obtener el archivo de SharePoint", { status: 502 });
  }
}
