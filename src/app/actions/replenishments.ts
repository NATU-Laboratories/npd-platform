"use server";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { replenishmentFiles, replenishments, suppliers } from "@/db/schema";
import { getStorage } from "@/lib/graph/storage";
import { REP_FILE_TAGS } from "@/lib/replenishment/config";
import { logActivity } from "@/lib/server/activity";
import { AuthzError, isAdmin, requireActionUser } from "@/lib/server/authz";
import { listProjects } from "@/lib/server/dashboard";
import { logError } from "@/lib/server/errors";
import {
  addComment,
  canAccessReplenishments,
  canCreateReplenishment,
  createReplenishment,
  lastItemsForProject,
  previewCreationEmails,
  registerQuote,
  repFolder,
  repLabNote,
  repLabTransition,
  REP_ACTIONS,
  sendQuoteRequests,
  supplierEmails,
  transition,
  updateItem,
  type RepAction,
  type RepEmail,
} from "@/lib/server/replenishments";
import { getSettings } from "@/lib/server/settings";
import type { ActionResult } from "./projects";

/** Errores que se muestran tal cual (validación y permisos); el resto se registra. */
async function run<T>(source: string, fn: () => Promise<T>, ctx?: Record<string, unknown>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Datos no válidos" };
    if (err instanceof AuthzError) return { ok: false, error: err.message };
    if (err instanceof Error && !/^(Failed|fetch|ECONN|relation|column|syntax)/i.test(err.message) && err.message.length < 200) {
      return { ok: false, error: err.message };
    }
    await logError(source, err, ctx);
    return { ok: false, error: "No se ha podido completar. Inténtalo de nuevo." };
  }
}

const touch = (id?: string) => {
  revalidatePath("/reposiciones");
  if (id) revalidatePath(`/reposiciones/${id}`);
};

// ─── Solicitud ────────────────────────────────────────────────────────────

export async function previewReplenishmentEmailsAction(input: unknown): Promise<ActionResult<RepEmail[]>> {
  return run("rep:preview", async () => previewCreationEmails(await requireActionUser(), input));
}

export async function createReplenishmentAction(input: unknown): Promise<ActionResult<{ id: string; code: string }>> {
  return run("rep:create", async () => {
    const res = await createReplenishment(await requireActionUser(), input);
    touch();
    return res;
  });
}

/** Proyectos NPD visibles para vincular la reposición. */
export async function searchNpdProjectsAction(q: string): Promise<ActionResult<{ id: string; label: string }[]>> {
  return run("rep:searchProjects", async () => {
    const u = await requireActionUser();
    if (!canCreateReplenishment(u)) throw new AuthzError();
    const { rows } = await listProjects(u, { q: z.string().max(100).parse(q) }, 30);
    return rows.filter((r) => r.code).slice(0, 15).map((r) => ({ id: r.id, label: `${r.code} · ${r.name}${r.clientName ? ` · ${r.clientName}` : r.brandName ? ` · ${r.brandName}` : ""}` }));
  });
}

export async function lastItemsForProjectAction(npdProjectId: string) {
  return run("rep:lastItems", async () => lastItemsForProject(await requireActionUser(), z.string().uuid().parse(npdProjectId)));
}

// ─── Flujo ────────────────────────────────────────────────────────────────

export async function replenishmentTransitionAction(
  id: string,
  action: RepAction,
  opts: { comment?: string | null; sendSupplierEmails?: boolean; supplierMessage?: string; corrections?: { text: string; fileIds: number[] }[] },
): Promise<ActionResult> {
  return run(
    "rep:transition",
    async () => {
      const u = await requireActionUser();
      await transition(u, z.string().uuid().parse(id), z.enum(REP_ACTIONS).parse(action), opts);
      touch(id);
      return undefined;
    },
    { id, action },
  );
}

export async function repLabTransitionAction(id: string, targetId: number, comment: string | null, lab?: unknown): Promise<ActionResult<{ completed: boolean }>> {
  return run(
    "rep:labTransition",
    async () => {
      const res = await repLabTransition(await requireActionUser(), z.string().uuid().parse(id), z.number().int().positive().parse(targetId), comment, lab);
      touch(id);
      return { completed: res.completed };
    },
    { id, targetId },
  );
}

export async function addRepLabNoteAction(id: string, body: string, isWait: boolean): Promise<ActionResult> {
  return run("rep:labNote", async () => {
    await repLabNote(await requireActionUser(), z.string().uuid().parse(id), body, isWait);
    touch(id);
    return undefined;
  });
}

export async function previewSupplierEmailsAction(id: string, kind: "quote" | "print", supplierId: number | null, message: string): Promise<ActionResult<RepEmail[]>> {
  return run("rep:previewSupplier", async () => supplierEmails(await requireActionUser(), z.string().uuid().parse(id), kind, supplierId, z.string().max(4000).parse(message)));
}

export async function requestQuotesAction(id: string, supplierId: number | null, message: string): Promise<ActionResult<{ sent: string[]; withoutEmail: string[] }>> {
  return run("rep:requestQuotes", async () => {
    const res = await sendQuoteRequests(await requireActionUser(), z.string().uuid().parse(id), supplierId, z.string().max(4000).parse(message));
    touch(id);
    return res;
  });
}

export async function registerQuoteAction(input: unknown): Promise<ActionResult> {
  return run("rep:quote", async () => {
    const id = await registerQuote(await requireActionUser(), input);
    touch(id);
    return undefined;
  });
}

export async function updateRepItemAction(input: unknown): Promise<ActionResult> {
  return run("rep:item", async () => {
    const id = await updateItem(await requireActionUser(), input);
    touch(id);
    return undefined;
  });
}

export async function addRepCommentAction(id: string, body: string): Promise<ActionResult> {
  return run("rep:comment", async () => {
    await addComment(await requireActionUser(), z.string().uuid().parse(id), body);
    touch(id);
    return undefined;
  });
}

// ─── Proveedores (alta rápida desde la solicitud) ─────────────────────────

const supplierInput = z.object({
  name: z.string().trim().min(1, "Pon el nombre del proveedor").max(200),
  emails: z.array(z.string().trim().toLowerCase().email("Email no válido")).max(10),
  contactName: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
});

export async function quickCreateSupplierAction(input: unknown): Promise<ActionResult<{ id: number; name: string; emails: string[] }>> {
  return run("rep:supplier", async () => {
    const u = await requireActionUser();
    if (!canCreateReplenishment(u)) throw new AuthzError("Solo Compras puede dar de alta proveedores");
    const s = supplierInput.parse(input);
    const [dup] = await db.select({ id: suppliers.id }).from(suppliers).where(sql`lower(${suppliers.name}) = ${s.name.toLowerCase()}`);
    if (dup) throw new Error("Ya existe un proveedor con ese nombre");
    const [row] = await db.insert(suppliers).values({ name: s.name, emails: s.emails, contactName: s.contactName || null, phone: s.phone || null }).returning();
    await logActivity({ actorId: u.id, action: "supplier.created", entity: "supplier", entityId: row!.id, diff: { name: s.name } });
    return { id: row!.id, name: row!.name, emails: row!.emails };
  });
}

// ─── Archivos (arte final, pruebas…) ──────────────────────────────────────

async function repForFiles(id: string) {
  const u = await requireActionUser();
  if (!canAccessReplenishments(u)) throw new AuthzError();
  const { r, folderId } = await repFolder(z.string().uuid().parse(id));
  return { u, r, folderId };
}

export async function createRepUploadAction(id: string, fileName: string, size: number): Promise<ActionResult<{ uploadUrl: string }>> {
  return run("rep:upload", async () => {
    const { folderId } = await repForFiles(id);
    const { max_file_mb } = await getSettings();
    if (size > max_file_mb * 1024 * 1024) throw new Error(`El archivo supera el límite de ${max_file_mb} MB`);
    return getStorage().createUploadSession(folderId, fileName);
  });
}

export async function registerRepFileAction(id: string, itemId: string, tag: string): Promise<ActionResult<{ id: number; name: string; size: number; mime: string | null }>> {
  return run("rep:registerFile", async () => {
    const { u, r, folderId } = await repForFiles(id);
    const item = await getStorage().getItem(itemId);
    if (item.parentId !== folderId) throw new Error("El archivo no pertenece a esta reposición");
    const safeTag = tag in REP_FILE_TAGS ? tag : "otro";
    const [row] = await db
      .insert(replenishmentFiles)
      .values({ replenishmentId: r.id, storageItemId: item.id, name: item.name, mime: item.mime ?? null, size: item.size, tag: safeTag, round: r.round, uploadedBy: u.id })
      .returning();
    await logActivity({ actorId: u.id, action: "replenishment.file_uploaded", entity: "replenishment", entityId: r.id, diff: { name: item.name, tag: safeTag, round: r.round } });
    touch(r.id);
    return { id: row!.id, name: row!.name, size: row!.size, mime: row!.mime };
  });
}

/** El arte final se indica con un enlace de OneDrive o SharePoint (no se sube el archivo). */
export async function addRepArtLinkAction(id: string, url: string, label: string): Promise<ActionResult> {
  return run("rep:artLink", async () => {
    const u = await requireActionUser();
    if (!canAccessReplenishments(u)) throw new AuthzError();
    const link = z
      .string()
      .trim()
      .max(2000)
      .regex(/^https:\/\/[^\s]+\.(sharepoint\.com|onedrive\.live\.com|1drv\.ms)(\/|$)\S*$/i, "Pega un enlace de OneDrive o SharePoint (empieza por https://)")
      .parse(url);
    const [r] = await db.select().from(replenishments).where(eq(replenishments.id, z.string().uuid().parse(id)));
    if (!r) throw new Error("Reposición no encontrada");
    if (["closed", "cancelled"].includes(r.status)) throw new Error("La reposición está cerrada");
    const name = z.string().trim().max(200).parse(label) || `Arte final · ronda ${r.round}`;
    await db.insert(replenishmentFiles).values({ replenishmentId: r.id, storageItemId: "", url: link, name, tag: "arte_final", round: r.round, uploadedBy: u.id });
    await logActivity({ actorId: u.id, action: "replenishment.art_link", entity: "replenishment", entityId: r.id, diff: { name, round: r.round } });
    touch(r.id);
    return undefined;
  });
}

export async function deleteRepFileAction(fileId: number): Promise<ActionResult> {
  return run("rep:deleteFile", async () => {
    const u = await requireActionUser();
    const [f] = await db.select({ f: replenishmentFiles, status: replenishments.status }).from(replenishmentFiles).innerJoin(replenishments, eq(replenishments.id, replenishmentFiles.replenishmentId)).where(eq(replenishmentFiles.id, fileId));
    if (!f) throw new Error("Archivo no encontrado");
    if (!(f.f.uploadedBy === u.id && !["closed", "cancelled"].includes(f.status)) && !isAdmin(u)) throw new AuthzError("Solo quien lo subió puede borrarlo");
    if (f.f.storageItemId) await getStorage().deleteItem(f.f.storageItemId).catch(() => undefined);
    await db.delete(replenishmentFiles).where(and(eq(replenishmentFiles.id, fileId)));
    await logActivity({ actorId: u.id, action: "replenishment.file_deleted", entity: "replenishment", entityId: f.f.replenishmentId, diff: { name: f.f.name } });
    touch(f.f.replenishmentId);
    return undefined;
  });
}

export async function updateRepFileTagAction(fileId: number, tag: string): Promise<ActionResult> {
  return run("rep:fileTag", async () => {
    const u = await requireActionUser();
    if (!canAccessReplenishments(u)) throw new AuthzError();
    if (!(tag in REP_FILE_TAGS)) throw new Error("Etiqueta no válida");
    const [f] = await db.update(replenishmentFiles).set({ tag }).where(eq(replenishmentFiles.id, fileId)).returning({ rid: replenishmentFiles.replenishmentId });
    if (f) touch(f.rid);
    return undefined;
  });
}

