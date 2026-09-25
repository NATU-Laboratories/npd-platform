"use server";
import { revalidatePath } from "next/cache";
import { AuthzError, requireActionUser } from "@/lib/server/authz";
import { logError } from "@/lib/server/errors";
import { saveSection, SheetError, transitionDept } from "@/lib/server/sheet";
import type { ActionResult } from "./projects";

async function run<T>(name: string, projectId: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    revalidatePath(`/proyectos/${projectId}`);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof SheetError || err instanceof AuthzError) return { ok: false, error: err.message };
    await logError(`action:${name}`, err, { projectId });
    return { ok: false, error: "Se ha producido un error inesperado. Queda registrado en el log." };
  }
}

/** Guarda los datos de un apartado de la ficha técnica (miembros del departamento). */
export async function saveSheetSectionAction(projectId: string, section: string, data: unknown) {
  return run("saveSheetSection", projectId, async () => saveSection(await requireActionUser(), projectId, section, data));
}

/** Avanza o retrocede el subestado de un departamento, con comentario opcional y campos pedidos por el destino. */
export async function transitionDeptAction(projectId: string, departmentId: number, targetId: number, comment?: string | null, values?: Record<string, unknown>) {
  return run("transitionDept", projectId, async () => transitionDept(await requireActionUser(), projectId, departmentId, targetId, comment, values));
}
