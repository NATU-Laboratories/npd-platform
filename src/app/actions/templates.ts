"use server";
import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projects, tasks, templateTaskDeps, templateTasks, workflowTemplates } from "@/db/schema";
import { LAST_PHASE } from "@/lib/labels";
import { logActivity } from "@/lib/server/activity";
import { requireAdminAction } from "@/lib/server/authz";

/**
 * Plantillas de flujo (Backoffice). Al aprobar P1 la plantilla que mejor encaja con
 * el proyecto propone los departamentos implicados (los de sus tareas).
 */

type Result = { ok: true; id?: number } | { ok: false; error: string };

const taskSchema = z.object({
  /** id existente o clave temporal («n1»…) para las tareas nuevas */
  key: z.string().min(1).max(40),
  phase: z.number().int().min(1).max(LAST_PHASE),
  departmentId: z.number().int().positive(),
  title: z.string().trim().min(1, "Cada tarea necesita un título").max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  isRequired: z.boolean(),
  estDays: z.number().int().min(0).max(365),
  deps: z.array(z.string()).max(50),
  returnsTo: z.string().nullable().optional(),
});

const templateSchema = z.object({
  id: z.number().int().positive().nullable(),
  name: z.string().trim().min(1, "Pon un nombre a la plantilla").max(200),
  isActive: z.boolean(),
  appliesTo: z.object({
    types: z.array(z.enum(["PL", "MP", "MDD"])).max(3),
    subtypes: z.array(z.string().max(60)).max(30),
    categories: z.array(z.string().max(60)).max(30),
  }),
  tasks: z.array(taskSchema).max(200),
});
export type TemplateInput = z.infer<typeof templateSchema>;

const fail = (err: unknown): Result => ({
  ok: false,
  error: err instanceof z.ZodError ? (err.issues[0]?.message ?? "Datos no válidos") : err instanceof Error ? err.message : "No se ha podido guardar",
});

export async function saveTemplateAction(raw: TemplateInput): Promise<Result> {
  const admin = await requireAdminAction();
  try {
    const t = templateSchema.parse(raw);
    const keys = new Set(t.tasks.map((x) => x.key));
    if (keys.size !== t.tasks.length) throw new Error("Hay tareas duplicadas");
    // Solo se puede depender de tareas de la misma fase o anteriores
    const phaseOf = new Map(t.tasks.map((x) => [x.key, x.phase]));
    for (const x of t.tasks) {
      for (const d of x.deps) {
        if (d === x.key || !keys.has(d)) throw new Error(`Dependencia no válida en «${x.title}»`);
        if (phaseOf.get(d)! > x.phase) throw new Error(`«${x.title}» no puede depender de una tarea de una fase posterior`);
      }
      if (x.returnsTo && (x.returnsTo === x.key || !keys.has(x.returnsTo))) throw new Error(`«${x.title}» devuelve a una tarea que no existe`);
    }
    const appliesTo = Object.fromEntries(Object.entries(t.appliesTo).filter(([, v]) => v.length)) as TemplateInput["appliesTo"];

    const id = await db.transaction(async (tx) => {
      let tplId = t.id;
      if (tplId) {
        const [exists] = await tx.select({ id: workflowTemplates.id }).from(workflowTemplates).where(eq(workflowTemplates.id, tplId));
        if (!exists) throw new Error("La plantilla ya no existe");
        await tx.update(workflowTemplates).set({ name: t.name, isActive: t.isActive, appliesTo }).where(eq(workflowTemplates.id, tplId));
      } else {
        const [row] = await tx.insert(workflowTemplates).values({ name: t.name, isActive: t.isActive, appliesTo }).returning({ id: workflowTemplates.id });
        tplId = row!.id;
      }
      // Tareas: se actualizan las existentes, se crean las nuevas y se borran las quitadas
      const current = await tx.select({ id: templateTasks.id }).from(templateTasks).where(eq(templateTasks.templateId, tplId));
      const currentIds = new Set(current.map((c) => c.id));
      const idOf = new Map<string, number>();
      for (const [i, x] of t.tasks.entries()) {
        const values = {
          phase: x.phase,
          departmentId: x.departmentId,
          title: x.title,
          description: x.description || null,
          isRequired: x.isRequired,
          estDays: x.estDays,
          sort: i,
          canReturnToTaskId: null,
        };
        const existing = /^\d+$/.test(x.key) && currentIds.has(Number(x.key)) ? Number(x.key) : null;
        if (existing) {
          await tx.update(templateTasks).set(values).where(eq(templateTasks.id, existing));
          idOf.set(x.key, existing);
        } else {
          const [row] = await tx.insert(templateTasks).values({ ...values, templateId: tplId }).returning({ id: templateTasks.id });
          idOf.set(x.key, row!.id);
        }
      }
      const keep = [...idOf.values()];
      const removed = [...currentIds].filter((cid) => !keep.includes(cid));
      if (removed.length) {
        await tx.update(tasks).set({ templateTaskId: null }).where(inArray(tasks.templateTaskId, removed));
        await tx.delete(templateTasks).where(inArray(templateTasks.id, removed));
      }
      // Devoluciones y dependencias (una vez conocidos todos los ids)
      for (const x of t.tasks) {
        if (x.returnsTo) await tx.update(templateTasks).set({ canReturnToTaskId: idOf.get(x.returnsTo)! }).where(eq(templateTasks.id, idOf.get(x.key)!));
      }
      if (keep.length) await tx.delete(templateTaskDeps).where(inArray(templateTaskDeps.taskId, keep));
      const deps = t.tasks.flatMap((x) => x.deps.map((d) => ({ taskId: idOf.get(x.key)!, dependsOnTaskId: idOf.get(d)! })));
      if (deps.length) await tx.insert(templateTaskDeps).values(deps);
      return tplId;
    });
    await logActivity({
      actorId: admin.id,
      action: t.id ? "admin.template.updated" : "admin.template.created",
      entity: "workflow_template",
      entityId: id,
      diff: { name: t.name, tasks: t.tasks.length, isActive: t.isActive },
    });
    revalidatePath("/admin/plantillas");
    return { ok: true, id };
  } catch (err) {
    return fail(err);
  }
}

/** Duplica una plantilla (nombre «… (copia)», inactiva) para crear otra parecida. */
export async function duplicateTemplateAction(id: number): Promise<Result> {
  const admin = await requireAdminAction();
  try {
    const [tpl] = await db.select().from(workflowTemplates).where(eq(workflowTemplates.id, z.number().int().parse(id)));
    if (!tpl) throw new Error("La plantilla ya no existe");
    const list = await db.select().from(templateTasks).where(eq(templateTasks.templateId, id));
    const deps = list.length ? await db.select().from(templateTaskDeps).where(inArray(templateTaskDeps.taskId, list.map((x) => x.id))) : [];
    const res = await saveTemplateAction({
      id: null,
      name: `${tpl.name} (copia)`.slice(0, 200),
      isActive: false,
      appliesTo: { types: (tpl.appliesTo.types ?? []) as ("PL" | "MP" | "MDD")[], subtypes: tpl.appliesTo.subtypes ?? [], categories: tpl.appliesTo.categories ?? [] },
      tasks: list
        .sort((a, b) => a.phase - b.phase || a.sort - b.sort)
        .map((x) => ({
          key: `n${x.id}`,
          phase: x.phase,
          departmentId: x.departmentId,
          title: x.title,
          description: x.description,
          isRequired: x.isRequired,
          estDays: x.estDays,
          deps: deps.filter((d) => d.taskId === x.id).map((d) => `n${d.dependsOnTaskId}`),
          returnsTo: x.canReturnToTaskId ? `n${x.canReturnToTaskId}` : null,
        })),
    });
    if (res.ok) await logActivity({ actorId: admin.id, action: "admin.template.duplicated", entity: "workflow_template", entityId: res.id!, diff: { from: id } });
    return res;
  } catch (err) {
    return fail(err);
  }
}

/**
 * Elimina una plantilla y sus tareas. Los proyectos que la usaron no cambian
 * (sus departamentos ya están asignados); solo dejan de mostrar el nombre de la plantilla.
 */
export async function deleteTemplateAction(id: number): Promise<Result> {
  const admin = await requireAdminAction();
  try {
    const tplId = z.number().int().positive().parse(id);
    const [tpl] = await db.select().from(workflowTemplates).where(eq(workflowTemplates.id, tplId));
    if (!tpl) return { ok: true };
    await db.transaction(async (tx) => {
      const list = await tx.select({ id: templateTasks.id }).from(templateTasks).where(eq(templateTasks.templateId, tplId));
      if (list.length) await tx.update(tasks).set({ templateTaskId: null }).where(inArray(tasks.templateTaskId, list.map((x) => x.id)));
      await tx.update(projects).set({ templateId: null }).where(eq(projects.templateId, tplId));
      await tx.delete(workflowTemplates).where(eq(workflowTemplates.id, tplId));
    });
    await logActivity({ actorId: admin.id, action: "admin.template.deleted", entity: "workflow_template", entityId: tplId, diff: { name: tpl.name } });
    revalidatePath("/admin/plantillas");
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Activa o desactiva (las inactivas no se proponen al aprobar P1). */
export async function toggleTemplateAction(id: number, isActive: boolean): Promise<Result> {
  const admin = await requireAdminAction();
  await db.update(workflowTemplates).set({ isActive: z.boolean().parse(isActive) }).where(eq(workflowTemplates.id, z.number().int().parse(id)));
  await logActivity({ actorId: admin.id, action: "admin.template.updated", entity: "workflow_template", entityId: id, diff: { isActive } });
  revalidatePath("/admin/plantillas");
  return { ok: true };
}
