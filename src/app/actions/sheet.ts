"use server";
import { revalidatePath } from "next/cache";
import { AuthzError, requireActionUser } from "@/lib/server/authz";
import { logError } from "@/lib/server/errors";
import { saveSection, setSectionStatus, SheetError } from "@/lib/server/sheet";
import type { SheetStatus } from "@/lib/sheet/sections";
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

/** Guarda los datos de un apartado de la ficha técnica (solo responsables del departamento). */
export async function saveSheetSectionAction(projectId: string, section: string, data: unknown) {
  return run("saveSheetSection", projectId, async () => saveSection(await requireActionUser(), projectId, section, data));
}

/** Marca un apartado como terminado, no aplicable o lo reabre. */
export async function setSheetStatusAction(projectId: string, section: string, status: SheetStatus, note?: string | null) {
  if (!["pending", "done", "na"].includes(status)) return { ok: false, error: "Estado no válido" } satisfies ActionResult;
  return run("setSheetStatus", projectId, async () => setSectionStatus(await requireActionUser(), projectId, section, status, note));
}
