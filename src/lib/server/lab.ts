import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { deptNotes, labSamples, users } from "@/db/schema";
import { isAdmin, type CurrentUser } from "./authz";

/** La fórmula de las muestras es confidencial: solo Laboratorio, Calidad y admin (ni el gestor de proyectos). */
export function canSeeLabFormula(u: CurrentUser) {
  return isAdmin(u) || u.departmentKeys.includes("idi") || u.departmentKeys.includes("calidad");
}

export type SampleView = { id: number; referenceId: number; round: number; code: string; formula: string | null; status: string; createdAt: string; by: string | null };
export type NoteView = { id: number; referenceId: number; body: string; isWait: boolean; createdAt: string; by: string | null };

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
  return rows.map(({ n, by }) => ({ id: n.id, referenceId: n.referenceId, body: n.body, isWait: n.isWait, createdAt: n.createdAt.toISOString(), by }));
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
