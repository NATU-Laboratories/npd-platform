import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import {
  departmentMembers,
  departments,
  deptSubstates,
  files,
  projectDepartments,
  projectDeptProgress,
  projectDeptTransitions,
  projects,
  projectSheet,
  users,
  type DeptSubstate,
  type Project,
} from "@/db/schema";
import { needsOlfactory } from "@/lib/brief/schema";
import { FIRST_RUNNING_PHASE, PHASES } from "@/lib/labels";
import {
  checkField,
  effectiveData,
  resolveFieldRef,
  sanitizeData,
  SHEET_SECTIONS,
  summarize,
  type SheetCtx,
  type SheetData,
  type SheetSection,
} from "@/lib/sheet/sections";
import { transitionsFrom } from "@/lib/sheet/substates";
import { logActivity } from "./activity";
import type { CurrentUser } from "./authz";
import { notifyProjectEvent } from "./notifications";
import { getSettings } from "./settings";

export type SheetDept = { id: number; key: string; name: string; color: string; members: string[] };

export type SheetEntry = {
  section: SheetSection;
  title: string;
  dept: SheetDept;
  data: SheetData;
  updatedBy: string | null;
  updatedAt: Date | null;
};

export type StepInfo = DeptSubstate & { doneAt: Date | null };

/** Tarjeta de un departamento en la ficha del proyecto. */
export type DeptCard = {
  dept: SheetDept;
  entries: SheetEntry[];
  /** Fase en la que empieza a trabajar el departamento (su primer apartado). */
  phase: number;
  steps: StepInfo[];
  current: DeptSubstate | null;
  /** Sin fila de progreso: aún no ha empezado (se muestra en el primer subestado). */
  started: boolean;
  enteredAt: Date | null;
  rounds: number;
  completed: boolean;
  completedAt: Date | null;
  /** El proyecto ya ha llegado a la fase del departamento. */
  due: boolean;
  /** Puede trabajar ya (los de En curso, solo tras aprobar P2). */
  active: boolean;
  /** Su estado lo mueve el flujo del proyecto (Comercial: cotización y P2), no hay botones. */
  auto: boolean;
  /** Departamento de En curso a la espera de que el cliente apruebe el presupuesto (P2). */
  waitsP2: boolean;
  next: DeptSubstate | null;
  backTargets: DeptSubstate[];
};

/** Departamento responsable de cada apartado (por defecto o reasignado en el backoffice). */
export async function sectionDeptKeys(): Promise<Record<string, string>> {
  const { sheet_departments } = await getSettings();
  return Object.fromEntries(SHEET_SECTIONS.map((s) => [s.key, sheet_departments?.[s.key] || s.dept]));
}

export async function sheetContext(p: Project, tx: DbOrTx = db): Promise<SheetCtx> {
  const fileRows = await tx
    .select({ tag: files.tag, n: sql<number>`count(*)::int` })
    .from(files)
    .where(eq(files.projectId, p.id))
    .groupBy(files.tag);
  return {
    olfactory: needsOlfactory(p.brief),
    brief: {
      name: p.brief.name ?? p.name ?? null,
      format: p.brief.format ?? null,
      markets: p.brief.markets ?? [],
      targetPrice: p.brief.targetPrice ?? null,
      rrp: p.brief.rrp ?? null,
      unitsFirstOrder: p.unitsFirstOrder ?? null,
      capacityMl: p.brief.capacityMl ?? null,
      references: p.brief.references ?? null,
    },
    filesByTag: Object.fromEntries(fileRows.map((r) => [r.tag ?? "otro", Number(r.n)])),
  };
}

async function deptsByKey(): Promise<Record<string, SheetDept>> {
  const [rows, members] = await Promise.all([
    db.select({ id: departments.id, key: departments.key, name: departments.name, color: departments.color }).from(departments),
    db
      .select({ key: departments.key, name: users.name })
      .from(departmentMembers)
      .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
      .innerJoin(users, eq(users.id, departmentMembers.userId))
      .where(eq(users.status, "active")),
  ]);
  return Object.fromEntries(
    rows
      .filter((r) => r.key)
      .map((r) => [r.key!, { id: r.id, key: r.key!, name: r.name, color: r.color, members: members.filter((l) => l.key === r.key).map((l) => l.name) }]),
  );
}

/** Subestados de todos los departamentos, ordenados. */
export async function allSubstates() {
  return db.select().from(deptSubstates).orderBy(asc(deptSubstates.departmentId), asc(deptSubstates.sort), asc(deptSubstates.id));
}

/** Datos de la ficha (apartados) y tarjetas por departamento de un proyecto. */
export async function loadSheet(p: Project): Promise<{ ctx: SheetCtx; entries: SheetEntry[]; cards: DeptCard[]; now: number }> {
  const [ctx, rows, depts, deptOf, substates, progress, transitions, involved] = await Promise.all([
    sheetContext(p),
    db
      .select({ s: projectSheet, updatedBy: users.name })
      .from(projectSheet)
      .leftJoin(users, eq(users.id, projectSheet.updatedBy))
      .where(eq(projectSheet.projectId, p.id)),
    deptsByKey(),
    sectionDeptKeys(),
    allSubstates(),
    db.select().from(projectDeptProgress).where(eq(projectDeptProgress.projectId, p.id)),
    db
      .select()
      .from(projectDeptTransitions)
      .where(eq(projectDeptTransitions.projectId, p.id))
      .orderBy(desc(projectDeptTransitions.createdAt), desc(projectDeptTransitions.id)),
    db.select({ id: projectDepartments.departmentId }).from(projectDepartments).where(eq(projectDepartments.projectId, p.id)),
  ]);
  const entries = SHEET_SECTIONS.map((section): SheetEntry => {
    const row = rows.find((r) => r.s.section === section.key);
    const key = deptOf[section.key]!;
    return {
      section,
      title: section.title,
      dept: depts[key] ?? { id: -1, key, name: key, color: "#77736d", members: [] },
      data: effectiveData(section, ctx, row?.s.data),
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.s.updatedAt ?? null,
    };
  });

  // Una tarjeta por departamento con apartados. Los de la etapa En curso solo si están
  // implicados en el proyecto (elegidos en P1); los de Validación (cotización) siempre.
  const involvedIds = new Set(involved.map((x) => x.id));
  const cards: DeptCard[] = [];
  for (const e of entries) {
    if (cards.some((c) => c.dept.key === e.dept.key)) continue;
    const deptEntries = entries.filter((x) => x.dept.key === e.dept.key);
    if (involvedIds.size && !involvedIds.has(e.dept.id) && Math.min(...deptEntries.map((x) => x.section.phase)) >= FIRST_RUNNING_PHASE) continue;
    const phase = Math.min(...deptEntries.map((x) => x.section.phase));
    const prog = progress.find((x) => x.departmentId === e.dept.id);
    const allSteps = substates.filter((s) => s.departmentId === e.dept.id);
    // Comercial sigue el flujo (1.º → 2.º → final): no se muestran estados intermedios que nunca se alcanzan
    const flowSteps = phase < FIRST_RUNNING_PHASE ? [allSteps[0], allSteps[1], allSteps.find((s) => s.isFinal) ?? allSteps.at(-1)] : allSteps;
    const steps = [...new Set(flowSteps.filter((s): s is DeptSubstate => !!s))];
    if (prog && phase < FIRST_RUNNING_PHASE && !steps.some((s) => s.id === prog.substateId)) {
      const extra = allSteps.find((s) => s.id === prog.substateId);
      if (extra) steps.splice(steps.length - 1, 0, extra);
    }
    const current = (prog && steps.find((s) => s.id === prog.substateId)) ?? steps[0] ?? null;
    // Fecha de cada subestado completado: la última vez que se avanzó desde él
    const deptTransitions = transitions.filter((t) => t.departmentId === e.dept.id);
    const curIdx = current ? steps.findIndex((s) => s.id === current.id) : 0;
    const stepInfos: StepInfo[] = steps.map((s, i) => ({
      ...s,
      doneAt:
        (i < curIdx || (current?.isFinal && s.id === current.id) ? deptTransitions.find((t) => t.fromSubstateId === s.id && t.direction === "forward")?.createdAt : null) ??
        (current?.isFinal && s.id === current.id ? (prog?.completedAt ?? null) : null),
    }));
    const auto = phase < FIRST_RUNNING_PHASE;
    // Proyectos que pasaron P2 antes de sincronizar Comercial: se muestra como completado
    const finalStep = steps.find((s) => s.isFinal) ?? steps.at(-1);
    const pastP2 = p.status === "in_production" || p.phase >= FIRST_RUNNING_PHASE;
    if (auto && pastP2 && finalStep && !prog?.completedAt) {
      cards.push({
        dept: e.dept,
        entries: deptEntries,
        phase,
        steps: stepInfos.map((s) => ({ ...s, doneAt: s.doneAt ?? (s.id === finalStep.id ? (prog?.enteredAt ?? null) : null) })),
        current: finalStep,
        started: true,
        enteredAt: prog?.enteredAt ?? null,
        rounds: prog?.rounds ?? 1,
        completed: true,
        completedAt: prog?.enteredAt ?? null,
        due: true,
        active: true,
        auto,
        waitsP2: false,
        next: null,
        backTargets: [],
      });
      continue;
    }
    const { next, backTargets } = transitionsFrom(steps, prog ? current : null);
    cards.push({
      dept: e.dept,
      entries: deptEntries,
      phase,
      steps: stepInfos,
      current,
      started: !!prog,
      enteredAt: prog?.enteredAt ?? null,
      rounds: prog?.rounds ?? 1,
      completed: !!prog?.completedAt,
      completedAt: prog?.completedAt ?? null,
      due: p.status === "in_production" || (p.status !== "draft" && p.phase >= phase),
      active: deptActive(phase, p),
      auto,
      waitsP2: phase >= FIRST_RUNNING_PHASE && ["in_progress", "paused"].includes(p.status) && p.phase < FIRST_RUNNING_PHASE,
      next,
      backTargets,
    });
  }
  cards.sort((a, b) => a.phase - b.phase);
  // Momento de referencia para "días en el estado actual"
  return { ctx, entries, cards, now: Date.now() };
}

/** Fase en la que empieza a trabajar cada departamento (la de su primer apartado). */
export async function deptStartPhases(): Promise<Record<string, number>> {
  const deptOf = await sectionDeptKeys();
  const out: Record<string, number> = {};
  for (const s of SHEET_SECTIONS) {
    const k = deptOf[s.key]!;
    out[k] = Math.min(out[k] ?? 99, s.phase);
  }
  return out;
}

/**
 * ¿El departamento ya puede trabajar en el proyecto? Los de la etapa En curso
 * no se activan hasta que el cliente aprueba el presupuesto (P2).
 */
export function deptActive(deptPhase: number, p: Pick<Project, "status" | "phase">) {
  if (p.status === "in_production") return true;
  if (!["in_progress", "paused"].includes(p.status)) return false;
  return p.phase >= Math.max(1, Math.min(deptPhase, FIRST_RUNNING_PHASE));
}

/**
 * ¿Puede editar los datos del departamento y cambiar su subestado? Solo los
 * miembros del departamento, el decisor global y los administradores, y solo
 * cuando el departamento está activo en el proyecto.
 */
export function canEditSection(u: CurrentUser, deptKey: string, deptPhase: number, p: Pick<Project, "status" | "phase">) {
  if (!deptActive(deptPhase, p)) return false;
  return u.roles.includes("admin") || u.roles.includes("global_decider") || u.departmentKeys.includes(deptKey);
}

/** Departamentos de fases ya alcanzadas que no han llegado a su subestado final (aviso al avanzar de fase). */
export function pendingUpTo(cards: DeptCard[], phase: number) {
  return cards.filter((c) => c.phase <= phase && !c.completed && c.steps.length > 0);
}

export async function loadProjectRow(projectId: string, tx: DbOrTx = db) {
  const [p] = await tx.select().from(projects).where(eq(projects.id, projectId));
  return p ?? null;
}

// ─── Mutaciones ───────────────────────────────────────────────────────────

export class SheetError extends Error {}

const LOCKED_MSG = "Este departamento se activa cuando el cliente aprueba el presupuesto (P2)";

/** Fija campos de un apartado de la ficha desde otra acción (p. ej. precios al cotizar o aprobar P2). */
export async function patchSheetSection(u: CurrentUser, p: Project, sectionKey: string, patch: SheetData, tx: DbOrTx = db) {
  const section = SHEET_SECTIONS.find((s) => s.key === sectionKey);
  if (!section) return;
  const ctx = await sheetContext(p, tx);
  const [prev] = await tx
    .select()
    .from(projectSheet)
    .where(and(eq(projectSheet.projectId, p.id), eq(projectSheet.section, sectionKey)));
  await writeSection(u, p, section, { ...effectiveData(section, ctx, prev?.data), ...patch }, ctx, tx);
}

/**
 * Los departamentos de Validación (Comercial) no se mueven a mano: siguen el
 * flujo del proyecto. «Enviar cotización» → 2.º subestado; P2 aprobado → final;
 * el cliente pide cambios → vuelta al primero (nueva ronda).
 */
export async function syncValidationDepts(u: CurrentUser, projectId: string, to: "quoted" | "approved" | "restart", comment: string | null, tx: DbOrTx = db) {
  const starts = await deptStartPhases();
  const keys = Object.keys(starts).filter((k) => starts[k]! < FIRST_RUNNING_PHASE);
  if (!keys.length) return;
  const ds = await tx.select().from(departments).where(inArray(departments.key, keys));
  for (const d of ds) {
    const steps = await tx.select().from(deptSubstates).where(eq(deptSubstates.departmentId, d.id)).orderBy(asc(deptSubstates.sort), asc(deptSubstates.id));
    const final = steps.find((s) => s.isFinal) ?? steps.at(-1);
    if (!final) continue;
    const target = to === "approved" ? final : to === "restart" ? steps[0]! : (steps[1] ?? final);
    const [prog] = await tx
      .select()
      .from(projectDeptProgress)
      .where(and(eq(projectDeptProgress.projectId, projectId), eq(projectDeptProgress.departmentId, d.id)));
    const current = (prog && steps.find((s) => s.id === prog.substateId)) ?? steps[0]!;
    if (current.id === target.id && (prog || target.id === steps[0]!.id)) continue;
    const back = steps.indexOf(target) < steps.indexOf(current);
    const rounds = (prog?.rounds ?? 1) + (back ? 1 : 0);
    const now = new Date();
    const completedAt = target.isFinal ? now : null;
    await tx
      .insert(projectDeptProgress)
      .values({ projectId, departmentId: d.id, substateId: target.id, enteredAt: now, rounds, completedAt, updatedBy: u.id })
      .onConflictDoUpdate({
        target: [projectDeptProgress.projectId, projectDeptProgress.departmentId],
        set: { substateId: target.id, enteredAt: now, rounds, completedAt, updatedBy: u.id },
      });
    await tx.insert(projectDeptTransitions).values({
      projectId,
      departmentId: d.id,
      fromSubstateId: current.id,
      toSubstateId: target.id,
      direction: back ? "back" : "forward",
      comment,
      actorId: u.id,
      createdAt: now,
    });
    await logActivity(
      {
        projectId,
        actorId: u.id,
        action: back ? "dept.returned" : target.isFinal ? "dept.completed" : "dept.advanced",
        entity: "department",
        entityId: d.id,
        diff: { department: d.name, from: current.name, to: target.name, round: rounds, comment },
      },
      tx,
    );
  }
}

function changedLabels(section: SheetSection, before: SheetData, after: SheetData) {
  const labels: string[] = [];
  for (const f of section.groups.flatMap((g) => g.fields)) {
    if (f.type === "files") continue;
    if (JSON.stringify(before[f.key] ?? null) !== JSON.stringify(after[f.key] ?? null)) labels.push(f.label);
  }
  return labels;
}

async function writeSection(u: CurrentUser, p: Project, section: SheetSection, raw: unknown, ctx: SheetCtx, tx: DbOrTx = db) {
  const clean = sanitizeData(section, raw);
  const [prev] = await tx
    .select()
    .from(projectSheet)
    .where(and(eq(projectSheet.projectId, p.id), eq(projectSheet.section, section.key)));
  const changes = changedLabels(section, effectiveData(section, ctx, prev?.data), clean);
  const now = new Date();
  await tx
    .insert(projectSheet)
    .values({ projectId: p.id, section: section.key, data: clean, updatedBy: u.id, updatedAt: now })
    .onConflictDoUpdate({ target: [projectSheet.projectId, projectSheet.section], set: { data: clean, updatedBy: u.id, updatedAt: now } });
  if (changes.length || !prev) {
    await logActivity(
      {
        projectId: p.id,
        actorId: u.id,
        action: "sheet.updated",
        entity: "project_sheet",
        entityId: section.key,
        diff: { section: section.key, title: section.title, fields: changes },
      },
      tx,
    );
  }
}

export async function saveSection(u: CurrentUser, projectId: string, sectionKey: string, raw: unknown) {
  const section = SHEET_SECTIONS.find((s) => s.key === sectionKey);
  if (!section) throw new SheetError("Apartado desconocido");
  const p = await loadProjectRow(projectId);
  if (!p) throw new SheetError("Proyecto no encontrado");
  const deptKey = (await sectionDeptKeys())[section.key]!;
  const deptPhase = (await deptStartPhases())[deptKey] ?? section.phase;
  if (!deptActive(deptPhase, p)) throw new SheetError(LOCKED_MSG);
  if (!canEditSection(u, deptKey, deptPhase, p)) throw new SheetError("Solo los miembros del departamento pueden editar este apartado");
  await writeSection(u, p, section, raw, await sheetContext(p));
}

/**
 * Avanza o retrocede el subestado de un departamento en un proyecto.
 * - Avanzar: solo al siguiente subestado; exige los campos obligatorios del
 *   destino y guarda los campos que el destino pide («apartado.campo»).
 * - Retroceder: a uno de los subestados permitidos; suma una ronda.
 * - Alcanzar el subestado final completa el trabajo del departamento.
 */
export async function transitionDept(
  u: CurrentUser,
  projectId: string,
  departmentId: number,
  targetId: number,
  comment?: string | null,
  values?: Record<string, unknown>,
) {
  const p = await loadProjectRow(projectId);
  if (!p) throw new SheetError("Proyecto no encontrado");
  const [dept] = await db.select().from(departments).where(eq(departments.id, departmentId));
  if (!dept?.key) throw new SheetError("Departamento no encontrado");
  const deptPhase = (await deptStartPhases())[dept.key] ?? FIRST_RUNNING_PHASE;
  if (!deptActive(deptPhase, p)) throw new SheetError(LOCKED_MSG);
  if (deptPhase < FIRST_RUNNING_PHASE)
    throw new SheetError(`El estado de ${dept.name} se actualiza solo al enviar la cotización y al registrar la respuesta del cliente (P2)`);
  if (!canEditSection(u, dept.key, deptPhase, p)) throw new SheetError("Solo los miembros del departamento pueden cambiar su estado");

  const steps = await db.select().from(deptSubstates).where(eq(deptSubstates.departmentId, departmentId)).orderBy(asc(deptSubstates.sort), asc(deptSubstates.id));
  const target = steps.find((s) => s.id === targetId);
  if (!target) throw new SheetError("Subestado no válido");
  const [prog] = await db
    .select()
    .from(projectDeptProgress)
    .where(and(eq(projectDeptProgress.projectId, projectId), eq(projectDeptProgress.departmentId, departmentId)));
  const current = prog ? (steps.find((s) => s.id === prog.substateId) ?? null) : null;
  const { next: allowedNext, backTargets } = transitionsFrom(steps, prog ? current : null);
  const direction: "forward" | "back" | null = allowedNext?.id === target.id ? "forward" : backTargets.some((b) => b.id === target.id) ? "back" : null;
  if (!direction) throw new SheetError("Ese cambio de subestado no está permitido desde el estado actual");
  const text = comment?.trim() || null;

  // Campos pedidos al entrar (se guardan en la ficha) y obligatorios del destino
  const deptOf = await sectionDeptKeys();
  const ctx = await sheetContext(p);
  const sheetRows = await db.select().from(projectSheet).where(eq(projectSheet.projectId, projectId));
  const dataOf = (key: string) => (sheetRows.find((r) => r.section === key)?.data ?? null) as SheetData | null;
  const updates = new Map<string, SheetData>();
  if (direction === "forward") {
    for (const ref of target.promptFields) {
      const r = resolveFieldRef(ref);
      if (!r || deptOf[r.section.key] !== dept.key || !values || !(ref in values)) continue;
      const base = updates.get(r.section.key) ?? { ...(dataOf(r.section.key) ?? {}) };
      base[r.field.key] = values[ref];
      updates.set(r.section.key, base);
    }
    const missing = target.requiredFields
      .map((ref) => {
        const r = resolveFieldRef(ref);
        if (!r) return null;
        const data = effectiveData(r.section, ctx, updates.get(r.section.key) ?? dataOf(r.section.key));
        const res = checkField(r.field, sanitizeData(r.section, data));
        return res.ok ? null : `${res.label} (${r.section.title})`;
      })
      .filter(Boolean);
    if (missing.length) throw new SheetError(`Para pasar a «${target.name}» falta: ${missing.join("; ")}`);
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    for (const [sectionKey, data] of updates) {
      const section = SHEET_SECTIONS.find((s) => s.key === sectionKey)!;
      await writeSection(u, p, section, data, ctx, tx);
    }
    const rounds = (prog?.rounds ?? 1) + (direction === "back" ? 1 : 0);
    const completedAt = target.isFinal ? now : null;
    await tx
      .insert(projectDeptProgress)
      .values({ projectId, departmentId, substateId: target.id, enteredAt: now, rounds, completedAt, updatedBy: u.id })
      .onConflictDoUpdate({
        target: [projectDeptProgress.projectId, projectDeptProgress.departmentId],
        set: { substateId: target.id, enteredAt: now, rounds, completedAt, updatedBy: u.id },
      });
    await tx.insert(projectDeptTransitions).values({
      projectId,
      departmentId,
      fromSubstateId: current?.id ?? steps[0]?.id ?? null,
      toSubstateId: target.id,
      direction,
      comment: text,
      actorId: u.id,
      createdAt: now,
    });
    await logActivity(
      {
        projectId,
        actorId: u.id,
        action: direction === "forward" ? (target.isFinal ? "dept.completed" : "dept.advanced") : "dept.returned",
        entity: "department",
        entityId: departmentId,
        diff: { department: dept.name, from: current?.name ?? steps[0]?.name ?? null, to: target.name, round: rounds, comment: text },
      },
      tx,
    );
  });

  const title =
    direction === "back"
      ? `${dept.name} vuelve a «${target.name}»`
      : target.isFinal
        ? `${dept.name} ha completado su parte (${target.name})`
        : `${dept.name}: ${target.name}`;
  await notifyProjectEvent(projectId, direction === "back" ? "dept.returned" : "dept.advanced", {
    title,
    intro:
      direction === "back"
        ? `${u.name} ha devuelto el trabajo de ${dept.name} a «${target.name}» (ronda ${(prog?.rounds ?? 1) + 1}).`
        : `${u.name} ha pasado ${dept.name} de «${current?.name ?? steps[0]?.name ?? "—"}» a «${target.name}».`,
    message: text ? { label: "Comentario", body: text } : null,
    to: { requester: true, accountManager: true, departmentKeys: [...new Set(["marketing", dept.key])] },
  });
  return { completed: target.isFinal, direction };
}

/**
 * Al entrar en una fase, avisa a cada departamento con apartados que arrancan
 * en ella, con el resumen de la información que necesita de otros departamentos.
 */
/**
 * Al aprobar P2: los departamentos implicados que entran más adelante (Diseño,
 * Operaciones, Compras…) reciben solo un aviso de que el proyecto está en marcha.
 * Los que empiezan ya en Desarrollo reciben el de notifyPhaseSections.
 */
export async function notifyProjectStarted(projectId: string) {
  const [starts, involved] = await Promise.all([
    deptStartPhases(),
    db
      .select({ key: departments.key, name: departments.name })
      .from(projectDepartments)
      .innerJoin(departments, eq(departments.id, projectDepartments.departmentId))
      .where(eq(projectDepartments.projectId, projectId)),
  ]);
  for (const d of involved) {
    if (!d.key) continue;
    const start = starts[d.key];
    if (start != null && start <= FIRST_RUNNING_PHASE) continue; // Comercial ya lo sabe; Desarrollo recibe «tienes trabajo»
    await notifyProjectEvent(projectId, "project.started", {
      title: "Nuevo proyecto en marcha",
      intro:
        start != null
          ? `El cliente ha aprobado el presupuesto y el proyecto arranca en «${PHASES[FIRST_RUNNING_PHASE]?.name}». ${d.name} entra más adelante, en la fase ${start} · ${PHASES[start]?.name}: os avisaremos cuando os toque.`
          : `El cliente ha aprobado el presupuesto y el proyecto arranca en «${PHASES[FIRST_RUNNING_PHASE]?.name}». ${d.name} está implicado en el proyecto; de momento no tenéis nada que hacer.`,
      to: { departmentKeys: [d.key] },
    });
  }
}

export async function notifyPhaseSections(projectId: string, phase: number) {
  const p = await loadProjectRow(projectId);
  if (!p) return;
  const { entries, ctx, cards } = await loadSheet(p);
  const starting = cards.filter((c) => c.phase === phase);
  if (!starting.length) return;
  const available = cards.filter((c) => c.completed).map((c) => c.dept.name);
  for (const card of starting) {
    const deps = [...new Set(card.entries.flatMap((e) => e.section.dependsOn ?? []))];
    const inputRows: [string, string][] = deps.flatMap((key) => {
      const e = entries.find((x) => x.section.key === key);
      if (!e) return [];
      const depCard = cards.find((c) => c.dept.key === e.dept.key);
      const state = depCard ? (depCard.completed ? "completado" : `en «${depCard.current?.name ?? "—"}»`) : "—";
      const lines = summarize(e.section, ctx, e.data);
      return [[`${e.title} · ${e.dept.name} · ${state}`, lines.length ? lines.join("\n") : "Sin datos todavía"] as [string, string]];
    });
    await notifyProjectEvent(projectId, "sheet.phase_opened", {
      title: `Fase «${PHASES[phase]?.name}»: tu departamento tiene trabajo`,
      intro: `El proyecto entra en «${PHASES[phase]?.name}». Actualiza el estado de ${card.dept.name} en la ficha del proyecto conforme avances; al llegar a «${card.steps.find((s) => s.isFinal)?.name ?? "el estado final"}» tu parte queda completada.`,
      extraRows: [["Departamentos que ya han completado su parte", available.length ? available.join(" · ") : "—"], ...inputRows],
      to: { departmentKeys: [card.dept.key] },
    });
  }
}

/** Subestado actual (o primero) de cada departamento en varios proyectos: widget del panel y "Requieren mi acción". */
export async function deptSubstateCounts(projectRows: { id: string; phase: number; status: string }[]) {
  const [depts, deptOf, substates] = await Promise.all([deptsByKey(), sectionDeptKeys(), allSubstates()]);
  const ids = projectRows.map((r) => r.id);
  const [progress, involved] = ids.length
    ? await Promise.all([
        db.select().from(projectDeptProgress).where(inArray(projectDeptProgress.projectId, ids)),
        db.select().from(projectDepartments).where(inArray(projectDepartments.projectId, ids)),
      ])
    : [[], []];
  const deptPhase = new Map<string, number>();
  for (const s of SHEET_SECTIONS) {
    const k = deptOf[s.key]!;
    deptPhase.set(k, Math.min(deptPhase.get(k) ?? 99, s.phase));
  }
  return [...deptPhase.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([key, phase]) => {
      const dept = depts[key];
      const steps = dept ? substates.filter((s) => s.departmentId === dept.id) : [];
      const counts = new Map<number, number>();
      for (const r of projectRows) {
        if (!dept || r.phase < phase || !["in_progress", "paused"].includes(r.status)) continue;
        const inv = involved.filter((x) => x.projectId === r.id);
        if (phase >= FIRST_RUNNING_PHASE && inv.length && !inv.some((x) => x.departmentId === dept.id)) continue;
        const prog = progress.find((x) => x.projectId === r.id && x.departmentId === dept.id);
        const sid = prog?.substateId ?? steps[0]?.id;
        if (sid != null) counts.set(sid, (counts.get(sid) ?? 0) + 1);
      }
      return { dept: dept ?? { id: -1, key, name: key, color: "#77736d", members: [] }, phase, steps: steps.map((s) => ({ ...s, n: counts.get(s.id) ?? 0 })) };
    })
    .filter((x) => x.steps.length);
}
