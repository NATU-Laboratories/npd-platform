"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { files, projects } from "@/db/schema";
import { FILE_TAGS } from "@/lib/labels";
import { getStorage } from "@/lib/graph/storage";
import { logActivity } from "@/lib/server/activity";
import { canEditBrief, canViewProject, isAdmin, requireActionUser } from "@/lib/server/authz";
import { logError } from "@/lib/server/errors";
import { uploadTargetFolder } from "@/lib/server/provisioning";
import { getSettings } from "@/lib/server/settings";
import type { ActionResult } from "./projects";

async function loadProject(id: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, id));
  if (!p) throw new Error("Proyecto no encontrado");
  return p;
}

/**
 * Crea una upload session de Graph en la carpeta destino. El navegador sube
 * los trozos directamente a SharePoint con la URL pre-autorizada (sin exponer
 * tokens y sin pasar por el límite de 4,5 MB de las funciones de Vercel).
 */
export async function createUploadAction(projectId: string, fileName: string, size: number, phase: number): Promise<ActionResult<{ uploadUrl: string }>> {
  try {
    const u = await requireActionUser();
    const p = await loadProject(projectId);
    const allowed = p.status === "draft" ? p.requesterId === u.id : await canViewProject(u, projectId);
    if (!allowed) return { ok: false, error: "Sin permiso para subir archivos a este proyecto" };
    if (p.status === "rejected" || p.status === "cancelled") return { ok: false, error: "El proyecto está cerrado" };
    const { max_file_mb } = await getSettings();
    if (size > max_file_mb * 1024 * 1024) return { ok: false, error: `El archivo supera el límite de ${max_file_mb} MB` };
    const folder = await uploadTargetFolder(projectId, p.status === "draft" ? 0 : phase);
    const session = await getStorage().createUploadSession(folder, fileName);
    return { ok: true, data: session };
  } catch (err) {
    await logError("action:createUpload", err, { projectId, fileName });
    return { ok: false, error: "No se pudo iniciar la subida (SharePoint). Inténtalo de nuevo." };
  }
}

/** Registra en BD un archivo ya subido, verificando que está en la carpeta del proyecto. */
export async function registerFileAction(
  projectId: string,
  itemId: string,
  tag: string | null,
  phase: number,
): Promise<ActionResult<{ id: number; name: string; size: number; mime: string | null }>> {
  try {
    const u = await requireActionUser();
    const p = await loadProject(projectId);
    const allowed = p.status === "draft" ? p.requesterId === u.id : await canViewProject(u, projectId);
    if (!allowed) return { ok: false, error: "Sin permiso" };
    const storage = getStorage();
    const item = await storage.getItem(itemId);
    const folder = await uploadTargetFolder(projectId, p.status === "draft" ? 0 : phase);
    if (item.parentId !== folder) return { ok: false, error: "El archivo no pertenece a este proyecto" };
    const safeTag = tag && tag in FILE_TAGS ? tag : "otro";
    const [row] = await db
      .insert(files)
      .values({
        projectId,
        sharepointItemId: item.id,
        name: item.name,
        mime: item.mime ?? null,
        size: item.size,
        tag: safeTag,
        phase: p.status === "draft" ? 0 : phase,
        uploadedBy: u.id,
      })
      .returning();
    if (p.status !== "draft") {
      await logActivity({ projectId, actorId: u.id, action: "file.uploaded", entity: "file", entityId: row!.id, diff: { name: item.name, tag: safeTag } });
      revalidatePath(`/proyectos/${projectId}`);
    }
    return { ok: true, data: { id: row!.id, name: row!.name, size: row!.size, mime: row!.mime } };
  } catch (err) {
    await logError("action:registerFile", err, { projectId, itemId });
    return { ok: false, error: "No se pudo registrar el archivo" };
  }
}

export async function updateFileTagAction(fileId: number, tag: string): Promise<ActionResult> {
  const u = await requireActionUser();
  const [f] = await db.select({ f: files, p: projects }).from(files).innerJoin(projects, eq(projects.id, files.projectId)).where(eq(files.id, fileId));
  if (!f) return { ok: false, error: "No encontrado" };
  if (f.f.uploadedBy !== u.id && !canEditBrief(u, f.p)) return { ok: false, error: "Sin permiso" };
  if (!(tag in FILE_TAGS)) return { ok: false, error: "Etiqueta no válida" };
  await db.update(files).set({ tag }).where(eq(files.id, fileId));
  return { ok: true };
}

export async function deleteFileAction(fileId: number): Promise<ActionResult> {
  try {
    const u = await requireActionUser();
    const [f] = await db.select({ f: files, p: projects }).from(files).innerJoin(projects, eq(projects.id, files.projectId)).where(eq(files.id, fileId));
    if (!f) return { ok: false, error: "No encontrado" };
    const own = f.f.uploadedBy === u.id;
    if (!(own && (f.p.status === "draft" || canEditBrief(u, f.p))) && !isAdmin(u)) return { ok: false, error: "Sin permiso" };
    await getStorage().deleteItem(f.f.sharepointItemId).catch(() => undefined);
    await db.delete(files).where(and(eq(files.id, fileId)));
    if (f.p.status !== "draft") {
      await logActivity({ projectId: f.p.id, actorId: u.id, action: "file.deleted", entity: "file", entityId: fileId, diff: { name: f.f.name } });
      revalidatePath(`/proyectos/${f.p.id}`);
    }
    return { ok: true };
  } catch (err) {
    await logError("action:deleteFile", err, { fileId });
    return { ok: false, error: "No se pudo eliminar el archivo" };
  }
}
