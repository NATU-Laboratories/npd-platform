import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { departments, deptNotes, deptSubstates, labSamples, projectDeptProgress, users } from "@/db/schema";
import { isAdmin, type CurrentUser } from "./authz";

/** La fórmula de las muestras es confidencial: solo Laboratorio, Calidad y admin (ni el gestor de proyectos). */
export function canSeeLabFormula(u: CurrentUser) {
  return isAdmin(u) || u.departmentKeys.includes("idi") || u.departmentKeys.includes("calidad");
}

export type SampleView = { id: number; referenceId: number; round: number; code: string; formula: string | null; status: string; createdAt: string; by: string | null };
export type NoteView = { id: number; referenceId: number; body: string; isWait: boolean; stage: string | null; createdAt: string; by: string | null };

/** Muestras del proyecto; la fórmula solo para quien puede verla. */
export async function listSamples(u: CurrentUser, projectId: string): Promise<SampleView[]> {
  const show = canSeeLabFormula(u);
  const rows = await db
    .select({ s: labSamples, by: users.name })
    .from(labSamples)
    .leftJoin(users, eq(users.id, labSamples.createdBy))
    .where(eq(labSamples.projectId, projectId))
    .orderBy(asc(labSamples.referenceId), asc(labSamples.round), asc(labSamples.id));
  return rows.map(({ s, by }) => ({
    id: s.id,
    referenceId: s.referenceId,
    round: s.round,
    code: s.code,
    formula: show ? s.formula : null,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    by,
  }));
}

export async function listNotes(projectId: string, departmentKey: string): Promise<NoteView[]> {
  const rows = await db
    .select({ n: deptNotes, by: users.name })
    .from(deptNotes)
    .leftJoin(users, eq(users.id, deptNotes.authorId))
    .where(and(eq(deptNotes.projectId, projectId), eq(deptNotes.departmentKey, departmentKey)))
    .orderBy(desc(deptNotes.createdAt))
    .limit(100);
  return rows.map(toView);
}

const toView = ({ n, by }: { n: typeof deptNotes.$inferSelect; by: string | null }): NoteView => ({
  id: n.id,
  referenceId: n.referenceId,
  body: n.body,
  isWait: n.isWait,
  stage: n.stage,
  createdAt: n.createdAt.toISOString(),
  by,
});

/** Bitácoras de todos los departamentos del proyecto, por clave de departamento. */
export async function listAllNotes(projectId: string): Promise<Record<string, NoteView[]>> {
  const rows = await db
    .select({ n: deptNotes, by: users.name })
    .from(deptNotes)
    .leftJoin(users, eq(users.id, deptNotes.authorId))
    .where(eq(deptNotes.projectId, projectId))
    .orderBy(desc(deptNotes.createdAt))
    .limit(500);
  const out: Record<string, NoteView[]> = {};
  for (const r of rows) (out[r.n.departmentKey] ??= []).push(toView(r));
  return out;
}

/** Estado actual de un departamento en el proyecto (o el primero, si aún no ha empezado). */
export async function deptStageName(projectId: string, departmentKey: string, referenceId = 0): Promise<{ department: string | null; stage: string | null }> {
  const [dept] = await db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.key, departmentKey));
  if (!dept) return { department: null, stage: null };
  const [cur] = await db
    .select({ name: deptSubstates.name })
    .from(projectDeptProgress)
    .innerJoin(deptSubstates, eq(deptSubstates.id, projectDeptProgress.substateId))
    .where(and(eq(projectDeptProgress.projectId, projectId), eq(projectDeptProgress.departmentId, dept.id), eq(projectDeptProgress.referenceId, referenceId)));
  if (cur) return { department: dept.name, stage: cur.name };
  const [first] = await db.select({ name: deptSubstates.name }).from(deptSubstates).where(eq(deptSubstates.departmentId, dept.id)).orderBy(asc(deptSubstates.sort)).limit(1);
  return { department: dept.name, stage: first?.name ?? null };
}

/** Datos que pide Laboratorio al pasar a evaluación o al aprobar. */
export const labTransitionSchema = z.object({
  samples: z
    .array(z.object({ code: z.string().trim().min(1, "Indica el código de referencia de cada muestra").max(80), formula: z.string().trim().max(2000).optional().nullable() }))
    .max(30)
    .optional(),
  approvedIds: z.array(z.number().int().positive()).max(50).optional(),
});
export type LabTransition = z.infer<typeof labTransitionSchema>;
