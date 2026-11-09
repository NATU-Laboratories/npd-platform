import "server-only";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { files, projects, replenishmentFiles, replenishments } from "@/db/schema";
import { dbStore, putFile, storageDriver } from "@/lib/graph/storage";
import { PHASE_FOLDERS } from "@/lib/labels";
import { logError } from "./errors";
import { ensureStagingFolder, provisionProjectFolder } from "./provisioning";
import { repFolder } from "./replenishments";

/**
 * Paso de los archivos del almacenamiento provisional (base de datos) a SharePoint.
 * Los ids del almacén provisional son UUID; los de SharePoint, no. Se procesa por tandas
 * (cada llamada trabaja ~40 s) y la copia en la base de datos se conserva.
 */
const UUID = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const isOld = (col: unknown) => sql`${col} ~* ${UUID}`;

export async function migrationPending() {
  const { rows } = await db.execute<{ projects: number; files: number; repFiles: number }>(sql`
    select
      (select count(*) from projects where status <> 'draft' and code is not null and (sharepoint_folder_id is null or sharepoint_folder_id ~* ${UUID}))::int as projects,
      (select count(*) from files where sharepoint_item_id ~* ${UUID})::int as files,
      (select count(*) from replenishment_files where storage_item_id ~* ${UUID})::int as "repFiles"`);
  return rows[0]!;
}

export async function migrateStep(budgetMs = 40_000) {
  if (storageDriver() !== "sharepoint") throw new Error("SharePoint no está configurado todavía");
  const start = Date.now();
  const left = () => Date.now() - start < budgetMs;
  const done = { projects: 0, files: 0, repFiles: 0, errors: 0 };

  // 1) Carpetas de los proyectos enviados (año / proyecto / subcarpetas por fase)
  const projs = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(ne(projects.status, "draft"), isNotNull(projects.code), sql`(${projects.sharepointFolderId} is null or ${isOld(projects.sharepointFolderId)})`));
  for (const p of projs) {
    if (!left()) break;
    try {
      await db
        .update(projects)
        .set({ sharepointFolderId: null, sharepointFolderUrl: null, sharepointSubfolders: null, stagingFolderId: null })
        .where(eq(projects.id, p.id));
      await provisionProjectFolder(p.id);
      done.projects++;
    } catch (err) {
      done.errors++;
      await logError("sharepoint:migrate:project", err, { projectId: p.id });
    }
  }

  // 2) Archivos de proyectos (a la subcarpeta de su fase; los de borradores, a su carpeta temporal)
  const fileRows = await db
    .select({ f: files, status: projects.status, subfolders: projects.sharepointSubfolders, staging: projects.stagingFolderId })
    .from(files)
    .innerJoin(projects, eq(projects.id, files.projectId))
    .where(isOld(files.sharepointItemId))
    .limit(200);
  for (const { f, status, subfolders, staging } of fileRows) {
    if (!left()) break;
    try {
      let folderId: string | undefined;
      if (status === "draft") {
        if (staging && new RegExp(UUID, "i").test(staging)) await db.update(projects).set({ stagingFolderId: null }).where(eq(projects.id, f.projectId));
        folderId = await ensureStagingFolder(f.projectId);
      } else {
        const key = String(Math.min(Math.max(f.phase, 0), PHASE_FOLDERS.length - 1)).padStart(2, "0");
        folderId = subfolders?.[key];
        if (!folderId) continue; // la carpeta del proyecto se crea en el paso 1 (siguiente tanda)
      }
      const { data, item } = await dbStore.read(f.sharepointItemId);
      const stored = await putFile(folderId, f.name, data, f.mime ?? item.mime ?? "application/octet-stream");
      await db.update(files).set({ sharepointItemId: stored.id }).where(eq(files.id, f.id));
      done.files++;
    } catch (err) {
      done.errors++;
      await logError("sharepoint:migrate:file", err, { fileId: f.id, name: f.name });
    }
  }

  // 3) Archivos de reposiciones (carpeta «Reposiciones / REP-…»)
  const repRows = await db.select().from(replenishmentFiles).where(isOld(replenishmentFiles.storageItemId)).limit(200);
  for (const f of repRows) {
    if (!left()) break;
    try {
      const [r] = await db.select({ folder: replenishments.storageFolderId }).from(replenishments).where(eq(replenishments.id, f.replenishmentId));
      if (r?.folder && new RegExp(UUID, "i").test(r.folder)) await db.update(replenishments).set({ storageFolderId: null }).where(eq(replenishments.id, f.replenishmentId));
      const { folderId } = await repFolder(f.replenishmentId);
      const { data, item } = await dbStore.read(f.storageItemId);
      const stored = await putFile(folderId, f.name, data, f.mime ?? item.mime ?? "application/octet-stream");
      await db.update(replenishmentFiles).set({ storageItemId: stored.id }).where(eq(replenishmentFiles.id, f.id));
      done.repFiles++;
    } catch (err) {
      done.errors++;
      await logError("sharepoint:migrate:repFile", err, { fileId: f.id, name: f.name });
    }
  }

  return { done, pending: await migrationPending() };
}
