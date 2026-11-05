import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLog, departments, deptNotes, deptSubstates, labSamples, replenishments, users } from "@/db/schema";
import { transitionsFrom } from "@/lib/sheet/substates";
import { logActivity } from "./activity";
import { AuthzError, type CurrentUser } from "./authz";
import { canSeeLabFormula, labTransitionSchema, type NoteView, type SampleView } from "./lab";
import type { DeptState } from "./sheet";

/**
 * Reformulación en Reposiciones: Laboratorio / I+D entra con los mismos subestados que en
 * un proyecto NPD (Backoffice → Estados de departamento), su bitácora y sus muestras.
 */

export async function labSteps() {
  const [d] = await db.select({ id: departments.id, name: departments.name, color: departments.color }).from(departments).where(eq(departments.key, "idi"));
  if (!d) return { dept: null, steps: [] };
  const steps = await db.select().from(deptSubstates).where(eq(deptSubstates.departmentId, d.id)).orderBy(asc(deptSubstates.sort), asc(deptSubstates.id));
  return { dept: d, steps };
}

type Rep = typeof replenishments.$inferSelect;

/** Estado de Laboratorio en la reposición (para el stepper y los botones). */
export async function repLabState(r: Rep): Promise<DeptState | null> {
  if (!r.labSubstateId && !r.labRounds) return null;
  const { steps } = await labSteps();
  if (!steps.length) return null;
  const current = steps.find((s) => s.id === r.labSubstateId) ?? steps[0]!;
  const curIdx = steps.findIndex((s) => s.id === current.id);
  const moves = await db
    .select({ diff: activityLog.diff, at: activityLog.createdAt })
    .from(activityLog)
    .where(and(eq(activityLog.entity, "replenishment"), eq(activityLog.entityId, r.id), eq(activityLog.action, "replenishment.lab_state")))
    .orderBy(desc(activityLog.createdAt));
  const doneAt = (id: number) => moves.find((m) => (m.diff as { fromId?: number; direction?: string })?.fromId === id && (m.diff as { direction?: string }).direction === "forward")?.at ?? null;
  const completed = !!r.labCompletedAt;
  const { next, backTargets } = transitionsFrom(steps, current);
  return {
    steps: steps.map((s, i) => ({ ...s, doneAt: i < curIdx ? doneAt(s.id) : completed && s.id === current.id ? r.labCompletedAt : null })),
    current,
    started: true,
    enteredAt: r.labEnteredAt,
    rounds: Math.max(1, r.labRounds),
    completed,
    completedAt: r.labCompletedAt,
    next: r.status === "reformulation" ? next : null,
    backTargets: r.status === "reformulation" ? backTargets : [],
  };
}

export async function listRepSamples(u: CurrentUser, repId: string): Promise<SampleView[]> {
  const show = canSeeLabFormula(u);
  const rows = await db
    .select({ s: labSamples, by: users.name })
    .from(labSamples)
    .leftJoin(users, eq(users.id, labSamples.createdBy))
    .where(eq(labSamples.replenishmentId, repId))
    .orderBy(asc(labSamples.round), asc(labSamples.id));
  return rows.map(({ s, by }) => ({ id: s.id, referenceId: 0, round: s.round, code: s.code, formula: show ? s.formula : null, status: s.status, createdAt: s.createdAt.toISOString(), by }));
}

export async function listRepNotes(repId: string): Promise<NoteView[]> {
  const rows = await db
    .select({ n: deptNotes, by: users.name })
    .from(deptNotes)
    .leftJoin(users, eq(users.id, deptNotes.authorId))
    .where(eq(deptNotes.replenishmentId, repId))
    .orderBy(desc(deptNotes.createdAt))
    .limit(100);
  return rows.map(({ n, by }) => ({ id: n.id, referenceId: 0, body: n.body, isWait: n.isWait, createdAt: n.createdAt.toISOString(), by }));
}

/** Arranca (o vuelve a arrancar) Laboratorio en su primer subestado. */
export async function startRepLab(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], r: Rep, now: Date) {
  const { steps } = await labSteps();
  await tx
    .update(replenishments)
    .set({ labSubstateId: steps[0]?.id ?? null, labEnteredAt: now, labCompletedAt: null, labRounds: r.labRounds + 1 })
    .where(eq(replenishments.id, r.id));
}

export class RepLabError extends Error {}

/**
 * Avance / retroceso de Laboratorio en la reformulación. Igual que en NPD: al pasar a
 * evaluación se indican las muestras; al llegar al final se marcan las aprobadas.
 * Devuelve si ha terminado (la reposición vuelve entonces a Calidad).
 */
export async function transitionRepLab(u: CurrentUser, r: Rep, targetId: number, comment: string | null, labRaw: unknown) {
  if (r.status !== "reformulation") throw new RepLabError("La reposición no está en reformulación");
  const { steps } = await labSteps();
  const current = steps.find((s) => s.id === r.labSubstateId) ?? steps[0];
  const target = steps.find((s) => s.id === targetId);
  if (!current || !target) throw new RepLabError("Estado no válido");
  const { next, backTargets } = transitionsFrom(steps, current);
  const direction = next?.id === target.id ? "forward" : backTargets.some((b) => b.id === target.id) ? "back" : null;
  if (!direction) throw new RepLabError("Ese cambio de estado no está permitido desde el estado actual");
  const lab = labRaw ? labTransitionSchema.parse(labRaw) : {};
  const toEvaluation = direction === "forward" && !target.isFinal && /evaluaci/i.test(target.name);
  const toFinal = direction === "forward" && target.isFinal;
  const newSamples = toEvaluation ? (lab.samples ?? []).filter((x) => x.code) : [];
  if (toEvaluation && !newSamples.length) throw new RepLabError("Indica al menos una muestra (código de referencia y fórmula) que pasa a evaluación");
  let pending: { id: number; code: string }[] = [];
  let approved: { id: number; code: string }[] = [];
  if (toFinal) {
    pending = await db
      .select({ id: labSamples.id, code: labSamples.code })
      .from(labSamples)
      .where(and(eq(labSamples.replenishmentId, r.id), eq(labSamples.status, "evaluation")));
    if (pending.length) {
      approved = pending.filter((x) => lab.approvedIds?.includes(x.id));
      if (!approved.length) throw new RepLabError("Marca la muestra o muestras aprobadas");
    }
  }
  const now = new Date();
  const formulaVisible = canSeeLabFormula(u);
  await db.transaction(async (tx) => {
    await tx
      .update(replenishments)
      .set({
        labSubstateId: target.id,
        labEnteredAt: now,
        updatedAt: now,
        ...(toFinal ? { labCompletedAt: now, ...(approved.length ? { approvedReference: approved.map((x) => x.code).join(", ") } : {}) } : {}),
      })
      .where(and(eq(replenishments.id, r.id), eq(replenishments.status, "reformulation")));
    if (newSamples.length)
      await tx.insert(labSamples).values(newSamples.map((x) => ({ replenishmentId: r.id, round: Math.max(1, r.labRounds), code: x.code, formula: formulaVisible ? x.formula || null : null, createdBy: u.id })));
    for (const x of pending)
      await tx
        .update(labSamples)
        .set({ status: approved.some((a) => a.id === x.id) ? "approved" : "not_approved", decidedBy: u.id, decidedAt: now })
        .where(eq(labSamples.id, x.id));
    await logActivity(
      {
        actorId: u.id,
        action: "replenishment.lab_state",
        entity: "replenishment",
        entityId: r.id,
        diff: {
          fromId: current.id,
          from: current.name,
          to: target.name,
          direction,
          comment,
          ...(newSamples.length ? { samples: newSamples.map((x) => x.code) } : {}),
          ...(approved.length ? { approved: approved.map((x) => x.code) } : {}),
        },
      },
      tx,
    );
  });
  return { completed: toFinal, approved: approved.map((x) => x.code) };
}

export async function addRepLabNote(u: CurrentUser, r: Rep, body: string, isWait: boolean) {
  if (!r.labRounds) throw new AuthzError("Laboratorio no participa en esta reposición");
  const text = z.string().trim().min(1, "Escribe la nota").max(4000).parse(body);
  await db.insert(deptNotes).values({ replenishmentId: r.id, departmentKey: "idi", body: text, isWait: !!isWait, authorId: u.id });
  await logActivity({ actorId: u.id, action: "replenishment.lab_note", entity: "replenishment", entityId: r.id, diff: { wait: !!isWait } });
}

/** Hora del servidor para los días en el estado actual. */
export const serverNow = () => Date.now();
