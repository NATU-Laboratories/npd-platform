import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { brands, clients, files, projects } from "@/db/schema";
import { PHASE_FOLDERS } from "@/lib/labels";
import { getStorage, putFile, readFile, storageFor } from "@/lib/graph/storage";
import { logActivity } from "./activity";
import { scheduleProjectDocs } from "./project-docs-queue";

const STAGING_ROOT = "_Borradores";

/** Carpeta temporal de un borrador, donde se suben los adjuntos antes de enviar. */
export async function ensureStagingFolder(projectId: string) {
  const [p] = await db.select({ staging: projects.stagingFolderId }).from(projects).where(eq(projects.id, projectId));
  if (p?.staging) return p.staging;
  const storage = getStorage();
  const stagingRoot = await storage.ensureFolder(await storage.rootId(), STAGING_ROOT);
  const folder = await storage.ensureFolder(stagingRoot.id, projectId);
  await db.update(projects).set({ stagingFolderId: folder.id }).where(eq(projects.id, projectId));
  return folder.id;
}

/** Año de la carpeta del proyecto: el de su código (2026-PL-0009 → 2026) o el de la solicitud. */
export function projectYear(p: { code: string | null; requestedAt?: Date | null; createdAt?: Date | null }) {
  const m = p.code?.match(/^(\d{4})-/);
  return m ? m[1]! : String((p.requestedAt ?? p.createdAt ?? new Date()).getFullYear());
}

/** Carpeta del año dentro de la carpeta base (se crea si no existe: 2027, 2028…). */
export async function yearFolder(year: string) {
  const storage = getStorage();
  return storage.ensureFolder(await storage.rootId(), year);
}

/** «nº proyecto. cliente. nombre proyecto» (en marca propia, la marca en lugar del cliente). */
export function projectFolderName(p: { code: string | null; name: string; clientName?: string | null; brandName?: string | null }) {
  return [p.code, p.clientName ?? p.brandName, p.name].filter(Boolean).join(". ");
}

/**
 * Crea `AAAA-XX-NNNN · Cliente/Marca · Nombre` con sus subcarpetas de fase y
 * mueve los adjuntos del borrador a `00 Solicitud` (§5 Paso 5, §9.1).
 * Idempotente: se puede reintentar desde la cola tantas veces como haga falta.
 */
export async function provisionProjectFolder(projectId: string) {
  const [row] = await db
    .select({ p: projects, clientName: clients.name, brandName: brands.name })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(brands, eq(brands.id, projects.brandId))
    .where(eq(projects.id, projectId));
  if (!row) throw new Error(`Proyecto ${projectId} no encontrado`);
  const { p } = row;
  if (!p.code) throw new Error("El proyecto no tiene código todavía");

  // Proyectos anteriores a SharePoint siguen en el almacenamiento provisional (no se les crea carpeta nueva)
  const storage = storageFor(p.sharepointFolderId);
  const alreadyProvisioned = !!p.sharepointFolderId;
  const folder = p.sharepointFolderId
    ? await storage.getItem(p.sharepointFolderId)
    : await storage.ensureFolder((await yearFolder(projectYear(p))).id, projectFolderName({ ...p, clientName: row.clientName, brandName: row.brandName }));

  const subfolders: Record<string, string> = { ...(p.sharepointSubfolders ?? {}) };
  for (const name of PHASE_FOLDERS) {
    const key = name.slice(0, 2);
    if (!subfolders[key]) subfolders[key] = (await storage.ensureFolder(folder.id, name)).id;
  }

  await db
    .update(projects)
    .set({ sharepointFolderId: folder.id, sharepointFolderUrl: folder.webUrl ?? null, sharepointSubfolders: subfolders })
    .where(eq(projects.id, projectId));

  // Adjuntos del borrador → «00 Solicitud». En el mismo almacén se mueven (conservan su id); si el
  // borrador se empezó antes de conectar SharePoint, se copian y se actualiza el registro del archivo.
  if (p.stagingFolderId) {
    const staging = storageFor(p.stagingFolderId);
    const staged = await staging.listChildren(p.stagingFolderId);
    for (const item of staged) {
      if (staging === storage) await storage.moveItem(item.id, subfolders["00"]!);
      else {
        const { data, mime } = await readFile(item.id);
        const copy = await putFile(subfolders["00"]!, item.name, data, mime ?? "application/octet-stream");
        await db.update(files).set({ sharepointItemId: copy.id }).where(eq(files.sharepointItemId, item.id));
      }
    }
    await staging.deleteItem(p.stagingFolderId).catch(() => undefined);
    await db.update(projects).set({ stagingFolderId: null }).where(eq(projects.id, projectId));
  }

  // Ficha (Word) e historial del proyecto en su carpeta
  await scheduleProjectDocs(projectId);

  if (!alreadyProvisioned) {
    await logActivity({ projectId, action: "sharepoint.provisioned", entity: "project", entityId: projectId, diff: { folder: folder.name } });
  }
}

/** Carpeta destino para subir un archivo al proyecto. */
export async function uploadTargetFolder(projectId: string, phase: number) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw new Error("Proyecto no encontrado");
  if (p.sharepointSubfolders) {
    const key = String(Math.min(Math.max(phase, 0), PHASE_FOLDERS.length - 1)).padStart(2, "0");
    const id = p.sharepointSubfolders[key];
    if (id) return id;
  }
  if (p.status !== "draft" && p.code) {
    // Enviado pero SharePoint aún no aprovisionado (fallo previo): reintentar ahora.
    await provisionProjectFolder(projectId);
    return uploadTargetFolder(projectId, phase);
  }
  return ensureStagingFolder(projectId);
}
