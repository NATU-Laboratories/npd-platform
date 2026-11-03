import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { projectDeptProgress, projectReferences, projectSheet, type Project } from "@/db/schema";
import { LABEL_INFO_FIELDS, missingLabelInfo } from "@/lib/brief/fields";
import { logActivity } from "./activity";
import type { CurrentUser } from "./authz";

export type RefInfo = { id: number; label: string; name: string; finalName: string | null; facing: string | null };

/** Referencias del proyecto, en orden. Con dos o más, el proyecto trabaja por referencia. */
export async function listReferences(projectId: string, tx: DbOrTx = db): Promise<RefInfo[]> {
  return tx
    .select({ id: projectReferences.id, label: projectReferences.label, name: projectReferences.name, finalName: projectReferences.finalName, facing: projectReferences.facing })
    .from(projectReferences)
    .where(eq(projectReferences.projectId, projectId))
    .orderBy(asc(projectReferences.sort), asc(projectReferences.id));
}

export const isMulti = (refs: RefInfo[]) => refs.length >= 2;

/** «A · Rosa» */
export const refTitle = (r: Pick<RefInfo, "label" | "name">) => (r.name && r.name !== `Referencia ${r.label}` ? `${r.label} · ${r.name}` : `Referencia ${r.label}`);

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const labelAt = (i: number) => (i < LETTERS.length ? LETTERS[i]! : `R${i + 1}`);

export class ReferenceError extends Error {}

/** Quién gestiona la lista de referencias: el solicitante, el gestor de cuenta, Marketing, gestor de proyectos y admin. */
export function canManageReferences(u: CurrentUser, p: Pick<Project, "requesterId" | "accountManagerId" | "status">) {
  if (["cancelled", "rejected", "in_production"].includes(p.status)) return false;
  return (
    p.requesterId === u.id ||
    p.accountManagerId === u.id ||
    u.roles.includes("admin") ||
    u.roles.includes("global_decider") ||
    u.departmentKeys.includes("marketing")
  );
}

/**
 * Crea referencias hasta llegar a `count`. Al pasar de una a varias, el estado que
 * ya tuvieran los departamentos (fila común) se copia a cada referencia, y los datos
 * comunes de la ficha actúan como valores por defecto de cada una.
 */
export async function ensureReferences(u: CurrentUser | null, projectId: string, count: number, tx: DbOrTx = db) {
  const existing = await listReferences(projectId, tx);
  if (count < 2 || existing.length >= count) return existing;
  const rows = [];
  for (let i = existing.length; i < count; i++) rows.push({ projectId, label: labelAt(i), name: `Referencia ${labelAt(i)}`, sort: i });
  const created = await tx.insert(projectReferences).values(rows).returning({ id: projectReferences.id });
  if (!existing.length) {
    const common = await tx
      .select()
      .from(projectDeptProgress)
      .where(and(eq(projectDeptProgress.projectId, projectId), eq(projectDeptProgress.referenceId, 0)));
    for (const prog of common) {
      await tx
        .insert(projectDeptProgress)
        .values(created.map((c) => ({ ...prog, referenceId: c.id })))
        .onConflictDoNothing();
    }
  }
  if (u) await logActivity({ projectId, actorId: u.id, action: "references.updated", entity: "project", entityId: projectId, diff: { count } }, tx);
  return listReferences(projectId, tx);
}

export async function renameReference(projectId: string, referenceId: number, name: string) {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new ReferenceError("El nombre no puede estar vacío");
  await db
    .update(projectReferences)
    .set({ name: clean })
    .where(and(eq(projectReferences.projectId, projectId), eq(projectReferences.id, referenceId)));
}

/** Elimina una referencia y sus datos. Un proyecto con varias referencias mantiene al menos dos. */
export async function deleteReference(u: CurrentUser, projectId: string, referenceId: number) {
  const refs = await listReferences(projectId);
  const ref = refs.find((r) => r.id === referenceId);
  if (!ref) throw new ReferenceError("Referencia no encontrada");
  if (refs.length <= 2) throw new ReferenceError("Un proyecto con varias referencias necesita al menos dos");
  await db.transaction(async (tx) => {
    await tx.delete(projectSheet).where(and(eq(projectSheet.projectId, projectId), eq(projectSheet.referenceId, referenceId)));
    await tx.delete(projectDeptProgress).where(and(eq(projectDeptProgress.projectId, projectId), eq(projectDeptProgress.referenceId, referenceId)));
    await tx.delete(projectReferences).where(eq(projectReferences.id, referenceId));
    await logActivity({ projectId, actorId: u.id, action: "references.deleted", entity: "project", entityId: projectId, diff: { reference: refTitle(ref) } }, tx);
  });
}

export async function referencesByIds(ids: number[]) {
  if (!ids.length) return [];
  return db.select().from(projectReferences).where(inArray(projectReferences.id, ids));
}

/**
 * Datos para la etiqueta que faltan. Con varias referencias, naming y facing van
 * por referencia (en project_references) e idiomas y países son comunes (brief).
 */
export function labelInfoMissing(p: Pick<Project, "brief">, refs: RefInfo[]): { key: string; label: string }[] {
  if (!isMulti(refs)) return missingLabelInfo(p.brief).map((f) => ({ key: f.key, label: f.label }));
  const common = missingLabelInfo(p.brief).filter((f) => f.key === "languages" || f.key === "markets");
  const label = (k: string) => LABEL_INFO_FIELDS.find((f) => f.key === k)!.label;
  const perRef = refs.flatMap((r) => [
    ...(r.finalName?.trim() ? [] : [{ key: `ref.${r.id}.finalName`, label: `${label("finalName")} (${refTitle(r)})` }]),
    ...(r.facing?.trim() ? [] : [{ key: `ref.${r.id}.facing`, label: `Facing (${refTitle(r)})` }]),
  ]);
  return [...perRef, ...common.map((f) => ({ key: f.key, label: f.label }))];
}
