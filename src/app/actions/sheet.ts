"use server";
import { revalidatePath } from "next/cache";
import { AuthzError, requireActionUser } from "@/lib/server/authz";
import { logError } from "@/lib/server/errors";
import { db } from "@/db";
import { canManageReferences, deleteReference, ensureReferences, ReferenceError, renameReference } from "@/lib/server/references";
import { canEditSection, deptStartPhases, loadProjectRow, saveSection, setFormulaTargetCost, SheetError, transitionDept } from "@/lib/server/sheet";
import { z } from "zod";
import { deptNotes } from "@/db/schema";
import { logActivity } from "@/lib/server/activity";
import type { ActionResult } from "./projects";

async function run<T>(name: string, projectId: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    revalidatePath(`/proyectos/${projectId}`);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof SheetError || err instanceof AuthzError) return { ok: false, error: err.message };
    if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Datos no válidos" };
    await logError(`action:${name}`, err, { projectId });
    return { ok: false, error: "Se ha producido un error inesperado. Queda registrado en el log." };
  }
}

/** Guarda los datos de un apartado de la ficha técnica (miembros del departamento), común o de una referencia. */
export async function saveSheetSectionAction(projectId: string, section: string, data: unknown, referenceId?: number) {
  return run("saveSheetSection", projectId, async () => saveSection(await requireActionUser(), projectId, section, data, referenceId));
}

/** Avanza o retrocede el subestado de un departamento (o de una de sus referencias), con comentario opcional y campos pedidos por el destino. */
export async function transitionDeptAction(
  projectId: string,
  departmentId: number,
  targetId: number,
  comment?: string | null,
  values?: Record<string, unknown>,
  referenceId?: number,
  lab?: unknown,
) {
  return run("transitionDept", projectId, async () => transitionDept(await requireActionUser(), projectId, departmentId, targetId, comment, values, referenceId, lab));
}

/** Nota en la bitácora de un departamento (Laboratorio: trabajo en curso, esperas y su motivo). */
export async function addDeptNoteAction(projectId: string, departmentKey: string, body: string, isWait: boolean, referenceId?: number) {
  return run("addDeptNote", projectId, async () => {
    const u = await requireActionUser();
    const p = await loadProjectRow(projectId);
    if (!p) throw new SheetError("Proyecto no encontrado");
    const key = z.string().max(40).parse(departmentKey);
    const phase = (await deptStartPhases())[key];
    if (phase == null || !canEditSection(u, key, phase, p)) throw new SheetError("Solo el departamento puede escribir en su bitácora");
    const text = z.string().trim().min(1, "Escribe la nota").max(4000).parse(body);
    await db.insert(deptNotes).values({ projectId, departmentKey: key, referenceId: referenceId ?? 0, body: text, isWait: !!isWait, authorId: u.id });
    await logActivity({ projectId, actorId: u.id, action: "dept.note", entity: "department", entityId: key, diff: { body: text.slice(0, 300), wait: !!isWait } });
  });
}

// ─── Referencias del proyecto ─────────────────────────────────────────────

async function referenceGuard(projectId: string) {
  const u = await requireActionUser();
  const p = await loadProjectRow(projectId);
  if (!p) throw new SheetError("Proyecto no encontrado");
  if (!canManageReferences(u, p)) throw new SheetError("No puedes gestionar las referencias de este proyecto");
  return { u, p };
}

/** Divide el proyecto en referencias o añade más (hasta `count`). */
export async function setReferenceCountAction(projectId: string, count: number) {
  return run("setReferenceCount", projectId, async () => {
    const { u } = await referenceGuard(projectId);
    const n = Math.max(2, Math.min(26, Math.floor(count)));
    await db.transaction((tx) => ensureReferences(u, projectId, n, tx));
  });
}

export async function renameReferenceAction(projectId: string, referenceId: number, name: string) {
  return run("renameReference", projectId, async () => {
    await referenceGuard(projectId);
    await renameReference(projectId, referenceId, name).catch((e) => {
      throw e instanceof ReferenceError ? new SheetError(e.message) : e;
    });
  });
}

export async function deleteReferenceAction(projectId: string, referenceId: number) {
  return run("deleteReference", projectId, async () => {
    const { u } = await referenceGuard(projectId);
    await deleteReference(u, projectId, referenceId).catch((e) => {
      throw e instanceof ReferenceError ? new SheetError(e.message) : e;
    });
  });
}

/** Coste objetivo de la fórmula (confidencial: Laboratorio, gestor de proyectos, admin y Operaciones). */
export async function saveFormulaCostAction(projectId: string, value: number | null) {
  return run("saveFormulaCost", projectId, async () => setFormulaTargetCost(await requireActionUser(), projectId, value));
}
