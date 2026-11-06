import "server-only";
import { labTransitionSchema } from "./lab";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import {
  clients,
  departmentMembers,
  departments,
  deptSubstates,
  files,
  labSamples,
  projectConfidential,
  projectDepartments,
  projectDeptProgress,
  projectDeptTransitions,
  projects,
  projectSheet,
  type DeptSubstate,
  type Project,
  users,
} from "@/db/schema";
import { briefSections, type Lookups } from "@/lib/brief/display";
import { needsOlfactory, parseBriefLenient } from "@/lib/brief/schema";
import { FIRST_RUNNING_PHASE, PHASES } from "@/lib/labels";
import {
  checkField,
  fieldApplies,
  effectiveData,
  fieldLabelInSection,
  isPerReferenceSection,
  PER_REFERENCE_SECTIONS,
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
import { canSeeFormulaCost, type CurrentUser } from "./authz";
import { getActiveUsers, getBrands, getCatalogLabels } from "./catalogs";
import { notifyProjectEvent } from "./notifications";
import { isMulti, labelInfoMissing, listReferences, refTitle, type RefInfo } from "./references";
import { getSettings } from "./settings";

export type SheetDept = { id: number; key: string; name: string; color: string; members: string[] };

export type SheetEntry = {
  section: SheetSection;
  title: string;
  dept: SheetDept;
  /** 0 = común al proyecto; si no, la referencia. */
  refId: number;
  data: SheetData;
  updatedBy: string | null;
  updatedAt: Date | null;
};

export type StepInfo = DeptSubstate & { doneAt: Date | null };

/** Estado de un departamento (en el proyecto o en una referencia). */
export type DeptState = {
  steps: StepInfo[];
  current: DeptSubstate | null;
  /** Sin fila de progreso: aún no ha empezado (se muestra en el primer subestado). */
  started: boolean;
  enteredAt: Date | null;
  rounds: number;
  completed: boolean;
  completedAt: Date | null;
  next: DeptSubstate | null;
  backTargets: DeptSubstate[];
};

/** Tarjeta de un departamento en la ficha del proyecto. */
export type DeptCard = DeptState & {
  dept: SheetDept;
  /** Apartados comunes del departamento (los de por referencia van en `refs`). */
  entries: SheetEntry[];
  /** Fase en la que empieza a trabajar el departamento (su primer apartado). */
  phase: number;
  /** Fase antes de cuyo cierre debe haber terminado (bloquea el avance a partir de ella). */
  dueBy: number;
  /** El proyecto ya ha llegado a la fase del departamento. */
  due: boolean;
  /** Puede trabajar ya (los de En curso, solo tras aprobar P2). */
  active: boolean;
  /** Su estado lo mueve el flujo del proyecto (Comercial: cotización y P2), no hay botones. */
  auto: boolean;
  /** Departamento de En curso a la espera de que el cliente apruebe el presupuesto (P2). */
  waitsP2: boolean;
  /** Avanza por separado en cada referencia: el estado de la tarjeta es el agregado (completado = todas). */
  perRef: boolean;
  refs: (DeptState & { ref: RefInfo; entries: SheetEntry[] })[];
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
      category: p.brief.category ?? null,
      references: p.brief.references ?? null,
      finalName: p.brief.finalName ?? null,
      languages: p.brief.languages ?? [],
    },
    filesByTag: Object.fromEntries(fileRows.map((r) => [r.tag ?? "otro", Number(r.n)])),
  };
}

/** Contexto de una referencia: el naming definitivo es el suyo. */
const ctxForRef = (ctx: SheetCtx, ref: RefInfo | null): SheetCtx => (ref ? { ...ctx, brief: { ...ctx.brief, finalName: ref.finalName } } : ctx);

/** ¿El departamento avanza por referencia? Sí si tiene algún apartado por referencia. */
function deptIsPerRef(deptKey: string, deptOf: Record<string, string>, multi: boolean, packagingMode: string) {
  return multi && SHEET_SECTIONS.some((s) => deptOf[s.key] === deptKey && isPerReferenceSection(s.key, multi, packagingMode));
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

type ProgressRow = typeof projectDeptProgress.$inferSelect;
type TransitionRow = typeof projectDeptTransitions.$inferSelect;

/** Estado (stepper, actual, fechas) a partir de la fila de progreso y el historial. */
function computeState(steps: DeptSubstate[], prog: ProgressRow | undefined, transitions: TransitionRow[]): DeptState {
  const current = (prog && steps.find((s) => s.id === prog.substateId)) ?? steps[0] ?? null;
  const curIdx = current ? steps.findIndex((s) => s.id === current.id) : 0;
  // Fecha de cada subestado completado: la última vez que se avanzó desde él
  const stepInfos: StepInfo[] = steps.map((s, i) => ({
    ...s,
    doneAt:
      (i < curIdx || (current?.isFinal && s.id === current.id) ? transitions.find((t) => t.fromSubstateId === s.id && t.direction === "forward")?.createdAt : null) ??
      (current?.isFinal && s.id === current.id ? (prog?.completedAt ?? null) : null),
  }));
  const { next, backTargets } = transitionsFrom(steps, prog ? current : null);
  return {
    steps: stepInfos,
    current,
    started: !!prog,
    enteredAt: prog?.enteredAt ?? null,
    rounds: prog?.rounds ?? 1,
    completed: !!prog?.completedAt,
    completedAt: prog?.completedAt ?? null,
    next,
    backTargets,
  };
}

/** Datos de la ficha (apartados) y tarjetas por departamento de un proyecto. */
export async function loadSheet(p: Project): Promise<{
  ctx: SheetCtx;
  entries: SheetEntry[];
  cards: DeptCard[];
  refs: RefInfo[];
  /** Precios por referencia (si se cotiza por referencia). */
  refPrices: { ref: RefInfo; unitPrice: number | null; finalUnitPrice: number | null }[];
  now: number;
}> {
  const [ctx, rows, depts, deptOf, substates, progress, transitions, involved, refs] = await Promise.all([
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
    listReferences(p.id),
  ]);
  const multi = isMulti(refs);
  const rowOf = (section: string, refId: number) => rows.find((r) => r.s.section === section && r.s.referenceId === refId);

  const entries: SheetEntry[] = SHEET_SECTIONS.flatMap((section): SheetEntry[] => {
    const key = deptOf[section.key]!;
    const dept = depts[key] ?? { id: -1, key, name: key, color: "#77736d", members: [] };
    const common = rowOf(section.key, 0);
    if (!isPerReferenceSection(section.key, multi, p.packagingMode)) {
      return [{ section, title: section.title, dept, refId: 0, data: effectiveData(section, ctx, common?.s.data), updatedBy: common?.updatedBy ?? null, updatedAt: common?.s.updatedAt ?? null }];
    }
    // Por referencia: lo común hace de valor por defecto de cada referencia
    return refs.map((ref) => {
      const own = rowOf(section.key, ref.id);
      return {
        section,
        title: section.title,
        dept,
        refId: ref.id,
        data: effectiveData(section, ctxForRef(ctx, ref), { ...(common?.s.data ?? {}), ...(own?.s.data ?? {}) }),
        updatedBy: own?.updatedBy ?? common?.updatedBy ?? null,
        updatedAt: own?.s.updatedAt ?? common?.s.updatedAt ?? null,
      };
    });
  });

  // Una tarjeta por departamento con apartados. Los de la etapa En curso solo si están
  // implicados en el proyecto (elegidos en P1); los de Validación (cotización) siempre.
  const involvedIds = new Set(involved.map((x) => x.id));
  const cards: DeptCard[] = [];
  for (const e of entries) {
    if (cards.some((c) => c.dept.key === e.dept.key)) continue;
    const deptEntries = entries.filter((x) => x.dept.key === e.dept.key);
    const phase = Math.min(...deptEntries.map((x) => x.section.phase));
    if (involvedIds.size && !involvedIds.has(e.dept.id) && phase >= FIRST_RUNNING_PHASE) continue;
    const perRef = deptIsPerRef(e.dept.key, deptOf, multi, p.packagingMode);
    const progOf = (refId: number) => progress.find((x) => x.departmentId === e.dept.id && x.referenceId === refId);
    const transOf = (refId: number) => transitions.filter((t) => t.departmentId === e.dept.id && t.referenceId === refId);
    const allSteps = substates.filter((s) => s.departmentId === e.dept.id);
    const auto = phase < FIRST_RUNNING_PHASE;
    // Comercial sigue el flujo (1.º → 2.º → final): no se muestran estados intermedios que nunca se alcanzan
    const flowSteps = auto ? [allSteps[0], allSteps[1], allSteps.find((s) => s.isFinal) ?? allSteps.at(-1)] : allSteps;
    const steps = [...new Set(flowSteps.filter((s): s is DeptSubstate => !!s))];
    const prog0 = progOf(0);
    if (prog0 && auto && !steps.some((s) => s.id === prog0.substateId)) {
      const extra = allSteps.find((s) => s.id === prog0.substateId);
      if (extra) steps.splice(steps.length - 1, 0, extra);
    }
    const dueBy = Math.max(...deptEntries.map((x) => x.section.dueBy ?? x.section.phase));
    const base = {
      dept: e.dept,
      phase,
      dueBy,
      due: p.status === "in_production" || (p.status !== "draft" && p.phase >= phase),
      active: deptActive(phase, p),
      auto,
      waitsP2: phase >= FIRST_RUNNING_PHASE && ["in_progress", "paused"].includes(p.status) && p.phase < FIRST_RUNNING_PHASE,
    };

    // Proyectos que pasaron P2 antes de sincronizar Comercial: se muestra como completado
    const finalStep = steps.find((s) => s.isFinal) ?? steps.at(-1);
    const pastP2 = p.status === "in_production" || p.phase >= FIRST_RUNNING_PHASE;
    if (auto && pastP2 && finalStep && !prog0?.completedAt) {
      const st = computeState(steps, prog0, transOf(0));
      cards.push({
        ...base,
        ...st,
        entries: deptEntries,
        steps: st.steps.map((s) => ({ ...s, doneAt: s.doneAt ?? (s.id === finalStep.id ? (prog0?.enteredAt ?? null) : null) })),
        current: finalStep,
        started: true,
        completed: true,
        completedAt: prog0?.enteredAt ?? null,
        due: true,
        active: true,
        waitsP2: false,
        next: null,
        backTargets: [],
        perRef: false,
        refs: [],
      });
      continue;
    }

    if (!perRef) {
      cards.push({ ...base, ...computeState(steps, prog0, transOf(0)), entries: deptEntries, perRef: false, refs: [] });
      continue;
    }
    const refStates = refs.map((ref) => ({ ...computeState(steps, progOf(ref.id), transOf(ref.id)), ref, entries: deptEntries.filter((x) => x.refId === ref.id) }));
    // Agregado: completado cuando lo están todas; el estado mostrado es el de la menos avanzada
    const pendingRef = refStates.find((r) => !r.completed);
    const shown = pendingRef ?? refStates.at(-1)!;
    const completed = refStates.every((r) => r.completed);
    cards.push({
      ...base,
      ...shown,
      started: refStates.some((r) => r.started),
      completed,
      completedAt: completed ? refStates.reduce<Date | null>((m, r) => (r.completedAt && (!m || r.completedAt > m) ? r.completedAt : m), null) : null,
      next: null,
      backTargets: [],
      entries: deptEntries.filter((x) => x.refId === 0),
      perRef: true,
      refs: refStates,
    });
  }
  cards.sort((a, b) => a.phase - b.phase);

  const refPrices =
    multi && p.pricingMode === "per_reference"
      ? refs.map((ref) => {
          const d = (rowOf("comercial", ref.id)?.s.data ?? {}) as SheetData;
          return { ref, unitPrice: typeof d.unitPrice === "number" ? d.unitPrice : null, finalUnitPrice: typeof d.finalUnitPrice === "number" ? d.finalUnitPrice : null };
        })
      : [];
  // Momento de referencia para "días en el estado actual"
  return { ctx, entries, cards, refs, refPrices, now: Date.now() };
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
 * miembros del departamento, el gestor de proyectos y los administradores, y solo
 * cuando el departamento está activo en el proyecto.
 */
export function canEditSection(u: CurrentUser, deptKey: string, deptPhase: number, p: Pick<Project, "status" | "phase">) {
  if (!deptActive(deptPhase, p)) return false;
  return u.roles.includes("admin") || u.roles.includes("global_decider") || u.departmentKeys.includes(deptKey);
}

/** Departamentos de fases ya alcanzadas que no han llegado a su subestado final (en todas sus referencias). */
export function pendingUpTo(cards: DeptCard[], phase: number) {
  return cards.filter((c) => c.dueBy <= phase && !c.completed && c.steps.length > 0);
}

export async function loadProjectRow(projectId: string, tx: DbOrTx = db) {
  const [p] = await tx.select().from(projects).where(eq(projects.id, projectId));
  return p ?? null;
}

// ─── Mutaciones ───────────────────────────────────────────────────────────

export class SheetError extends Error {}

const LOCKED_MSG = "Este departamento se activa cuando el cliente aprueba el presupuesto (P2)";

/** Datos guardados (sin efectivos) de un apartado: común o de una referencia. */
async function savedData(projectId: string, sectionKey: string, refId: number, tx: DbOrTx = db) {
  const [row] = await tx
    .select()
    .from(projectSheet)
    .where(and(eq(projectSheet.projectId, projectId), eq(projectSheet.section, sectionKey), eq(projectSheet.referenceId, refId)));
  return (row?.data ?? null) as SheetData | null;
}

/** Fija campos de un apartado de la ficha desde otra acción (p. ej. precios al cotizar o aprobar P2). */
export async function patchSheetSection(u: CurrentUser, p: Project, sectionKey: string, patch: SheetData, tx: DbOrTx = db, refId = 0) {
  const section = SHEET_SECTIONS.find((s) => s.key === sectionKey);
  if (!section) return;
  const ctx = await sheetContext(p, tx);
  const prev = await savedData(p.id, sectionKey, refId, tx);
  // En filas de referencia solo se guardan los campos propios (lo común sigue heredándose)
  const base = refId ? (prev ?? {}) : effectiveData(section, ctx, prev);
  await writeSection(u, p, section, { ...base, ...patch }, ctx, tx, refId);
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
      .where(and(eq(projectDeptProgress.projectId, projectId), eq(projectDeptProgress.departmentId, d.id), eq(projectDeptProgress.referenceId, 0)));
    const current = (prog && steps.find((s) => s.id === prog.substateId)) ?? steps[0]!;
    if (current.id === target.id && (prog || target.id === steps[0]!.id)) continue;
    const back = steps.indexOf(target) < steps.indexOf(current);
    const rounds = (prog?.rounds ?? 1) + (back ? 1 : 0);
    const now = new Date();
    const completedAt = target.isFinal ? now : null;
    await tx
      .insert(projectDeptProgress)
      .values({ projectId, departmentId: d.id, referenceId: 0, substateId: target.id, enteredAt: now, rounds, completedAt, updatedBy: u.id })
      .onConflictDoUpdate({
        target: [projectDeptProgress.projectId, projectDeptProgress.departmentId, projectDeptProgress.referenceId],
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

async function writeSection(u: CurrentUser, p: Project, section: SheetSection, raw: unknown, ctx: SheetCtx, tx: DbOrTx = db, refId = 0, refLabel?: string) {
  const clean = sanitizeData(section, raw);
  const prev = await savedData(p.id, section.key, refId, tx);
  const changes = changedLabels(section, refId ? (prev ?? {}) : effectiveData(section, ctx, prev), clean);
  const now = new Date();
  await tx
    .insert(projectSheet)
    .values({ projectId: p.id, section: section.key, referenceId: refId, data: clean, updatedBy: u.id, updatedAt: now })
    .onConflictDoUpdate({
      target: [projectSheet.projectId, projectSheet.section, projectSheet.referenceId],
      set: { data: clean, updatedBy: u.id, updatedAt: now },
    });
  if (changes.length || !prev) {
    await logActivity(
      {
        projectId: p.id,
        actorId: u.id,
        action: "sheet.updated",
        entity: "project_sheet",
        entityId: section.key,
        diff: { section: section.key, title: refLabel ? `${section.title} · ${refLabel}` : section.title, fields: changes },
      },
      tx,
    );
  }
}

/** Referencia válida para un apartado/departamento: la indicada si va por referencia; 0 si es común. */
async function resolveRef(p: Project, perRefOf: (multi: boolean) => boolean, referenceId: number | undefined) {
  const refs = await listReferences(p.id);
  const multi = isMulti(refs);
  if (!perRefOf(multi)) return { refs, multi, ref: null };
  const ref = refs.find((r) => r.id === referenceId);
  if (!ref) throw new SheetError("Indica la referencia");
  return { refs, multi, ref };
}

export async function saveSection(u: CurrentUser, projectId: string, sectionKey: string, raw: unknown, referenceId?: number) {
  const section = SHEET_SECTIONS.find((s) => s.key === sectionKey);
  if (!section) throw new SheetError("Apartado desconocido");
  const p = await loadProjectRow(projectId);
  if (!p) throw new SheetError("Proyecto no encontrado");
  const deptKey = (await sectionDeptKeys())[section.key]!;
  const deptPhase = (await deptStartPhases())[deptKey] ?? section.phase;
  if (!deptActive(deptPhase, p)) throw new SheetError(LOCKED_MSG);
  if (!canEditSection(u, deptKey, deptPhase, p)) throw new SheetError("Solo los miembros del departamento pueden editar este apartado");
  const { ref } = await resolveRef(p, (multi) => isPerReferenceSection(section.key, multi, p.packagingMode), referenceId);
  await writeSection(u, p, section, raw, ctxForRef(await sheetContext(p), ref), db, ref?.id ?? 0, ref ? refTitle(ref) : undefined);
}

/**
 * Avanza o retrocede el subestado de un departamento en un proyecto (o en una
 * referencia, si el departamento trabaja por referencia).
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
  referenceId?: number,
  labRaw?: unknown,
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

  const deptOf = await sectionDeptKeys();
  const { refs, multi, ref } = await resolveRef(p, (m) => deptIsPerRef(dept.key!, deptOf, m, p.packagingMode), referenceId);
  const refId = ref?.id ?? 0;
  const deptLabel = ref ? `${dept.name} · ${refTitle(ref)}` : dept.name;

  const steps = await db.select().from(deptSubstates).where(eq(deptSubstates.departmentId, departmentId)).orderBy(asc(deptSubstates.sort), asc(deptSubstates.id));
  const target = steps.find((s) => s.id === targetId);
  if (!target) throw new SheetError("Subestado no válido");
  const [prog] = await db
    .select()
    .from(projectDeptProgress)
    .where(and(eq(projectDeptProgress.projectId, projectId), eq(projectDeptProgress.departmentId, departmentId), eq(projectDeptProgress.referenceId, refId)));
  const current = prog ? (steps.find((s) => s.id === prog.substateId) ?? null) : null;
  const { next: allowedNext, backTargets } = transitionsFrom(steps, prog ? current : null);
  const direction: "forward" | "back" | null = allowedNext?.id === target.id ? "forward" : backTargets.some((b) => b.id === target.id) ? "back" : null;
  if (!direction) throw new SheetError("Ese cambio de subestado no está permitido desde el estado actual");
  const text = comment?.trim() || null;

  // Laboratorio: al pasar a evaluación indica las muestras (código + fórmula); al aprobar,
  // marca cuáles se aprueban (la «referencia aprobada» de la ficha se rellena con sus códigos)
  const lab = labRaw ? labTransitionSchema.parse(labRaw) : {};
  const isLab = dept.key === "idi" && direction === "forward";
  const toEvaluation = isLab && !target.isFinal && /evaluaci/i.test(target.name);
  const toApproved = isLab && target.isFinal;
  const newSamples = toEvaluation ? (lab.samples ?? []).filter((x) => x.code) : [];
  if (toEvaluation && !newSamples.length) throw new SheetError("Indica al menos una muestra (código de referencia y fórmula) que pasa a evaluación");
  let pendingSamples: { id: number; code: string }[] = [];
  let approvedSamples: { id: number; code: string }[] = [];
  if (toApproved) {
    pendingSamples = await db
      .select({ id: labSamples.id, code: labSamples.code })
      .from(labSamples)
      .where(and(eq(labSamples.projectId, projectId), eq(labSamples.referenceId, refId), eq(labSamples.status, "evaluation")));
    if (pendingSamples.length) {
      approvedSamples = pendingSamples.filter((x) => lab.approvedIds?.includes(x.id));
      if (!approvedSamples.length) throw new SheetError("Marca la muestra o muestras aprobadas");
    }
  }

  // Campos pedidos al entrar (se guardan en la ficha) y obligatorios del destino.
  // Los apartados por referencia se leen/escriben en la fila de esa referencia.
  const ctx = await sheetContext(p);
  const sheetRows = await db.select().from(projectSheet).where(eq(projectSheet.projectId, projectId));
  const rowRef = (sectionKey: string) => (isPerReferenceSection(sectionKey, multi, p.packagingMode) ? refId : 0);
  const saved = (sectionKey: string, rid: number) => (sheetRows.find((r) => r.section === sectionKey && r.referenceId === rid)?.data ?? null) as SheetData | null;
  const updates = new Map<string, SheetData>();
  const effective = (section: SheetSection) => {
    const rid = rowRef(section.key);
    const own = updates.get(section.key) ?? saved(section.key, rid);
    const merged = rid ? { ...(saved(section.key, 0) ?? {}), ...(own ?? {}) } : own;
    return effectiveData(section, ctxForRef(ctx, rid ? ref : null), merged);
  };
  if (approvedSamples.length) {
    const base = { ...(saved("formula", rowRef("formula")) ?? {}) };
    base.approvedReference = approvedSamples.map((x) => x.code).join(", ");
    updates.set("formula", base);
  }
  if (direction === "forward") {
    for (const fref of target.promptFields) {
      const r = resolveFieldRef(fref);
      if (!r || deptOf[r.section.key] !== dept.key || !values || !(fref in values)) continue;
      const base = updates.get(r.section.key) ?? { ...(saved(r.section.key, rowRef(r.section.key)) ?? {}) };
      base[r.field.key] = values[fref];
      updates.set(r.section.key, base);
    }
    const missing = target.requiredFields
      .map((fref) => {
        const r = resolveFieldRef(fref);
        if (!r || !fieldApplies(r.field, ctx)) return null;
        const res = checkField(r.field, sanitizeData(r.section, effective(r.section)));
        return res.ok ? null : `${fieldLabelInSection(r.section, r.field.key)} (${r.section.title})`;
      })
      .filter(Boolean);
    if (missing.length) throw new SheetError(`Para pasar a «${target.name}»${ref ? ` (${refTitle(ref)})` : ""} falta: ${missing.join("; ")}`);
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    for (const [sectionKey, data] of updates) {
      const section = SHEET_SECTIONS.find((s) => s.key === sectionKey)!;
      const rid = rowRef(sectionKey);
      await writeSection(u, p, section, data, ctxForRef(ctx, rid ? ref : null), tx, rid, rid && ref ? refTitle(ref) : undefined);
    }
    const rounds = (prog?.rounds ?? 1) + (direction === "back" ? 1 : 0);
    if (newSamples.length)
      await tx
        .insert(labSamples)
        .values(newSamples.map((x) => ({ projectId, referenceId: refId, round: rounds, code: x.code, formula: x.formula || null, createdBy: u.id })));
    if (pendingSamples.length)
      for (const x of pendingSamples)
        await tx
          .update(labSamples)
          .set({ status: approvedSamples.some((a) => a.id === x.id) ? "approved" : "not_approved", decidedBy: u.id, decidedAt: now })
          .where(eq(labSamples.id, x.id));
    const completedAt = target.isFinal ? now : null;
    await tx
      .insert(projectDeptProgress)
      .values({ projectId, departmentId, referenceId: refId, substateId: target.id, enteredAt: now, rounds, completedAt, updatedBy: u.id })
      .onConflictDoUpdate({
        target: [projectDeptProgress.projectId, projectDeptProgress.departmentId, projectDeptProgress.referenceId],
        set: { substateId: target.id, enteredAt: now, rounds, completedAt, updatedBy: u.id },
      });
    await tx.insert(projectDeptTransitions).values({
      projectId,
      departmentId,
      referenceId: refId,
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
        diff: {
          department: deptLabel,
          from: current?.name ?? steps[0]?.name ?? null,
          to: target.name,
          round: rounds,
          comment: text,
          // Solo códigos: la fórmula es confidencial y no va al historial
          ...(newSamples.length ? { samples: newSamples.map((x) => x.code) } : {}),
          ...(approvedSamples.length ? { approved: approvedSamples.map((x) => x.code) } : {}),
        },
      },
      tx,
    );
  });

  // Solo se avisa por email cuando el departamento completa su parte (en cada referencia);
  // los pasos intermedios quedan en la actividad del proyecto.
  if (direction === "forward" && target.isFinal) {
    // Departamentos implicados que necesitan la información de este (apartados con dependsOn)
    const ownSections = new Set(Object.keys(deptOf).filter((k) => deptOf[k] === dept.key));
    const involvedKeys = new Set(
      (
        await db
          .select({ key: departments.key })
          .from(projectDepartments)
          .innerJoin(departments, eq(departments.id, projectDepartments.departmentId))
          .where(eq(projectDepartments.projectId, projectId))
      ).map((r) => r.key),
    );
    const dependents = SHEET_SECTIONS.filter((s) => s.dependsOn?.some((d) => ownSections.has(d)))
      .map((s) => deptOf[s.key]!)
      .filter((k) => k !== dept.key && (!involvedKeys.size || involvedKeys.has(k)));
    const labelMissing = dept.key === "idi" && labelInfoMissing(p, refs).length > 0;
    await notifyProjectEvent(projectId, "dept.completed", {
      title: `${deptLabel} ha completado su parte (${target.name})`,
      intro: `${u.name} ha marcado «${target.name}»: ${deptLabel} ha terminado su parte del proyecto.`,
      message: text ? { label: "Comentario", body: text } : null,
      // Si falta información para la etiqueta, el comercial recibe solo el aviso específico (requestLabelInfo)
      to: { requester: !labelMissing, accountManager: !labelMissing, departmentKeys: [...new Set(["marketing", ...dependents].filter((k) => k !== dept.key))] },
      exclude: u.email,
    });
    // Fórmula aprobada por el cliente: se pide al comercial lo que falte para la etiqueta
    if (dept.key === "idi") await requestLabelInfo(u, projectId);
  }
  return { completed: target.isFinal, direction };
}

/** Pide al comercial (y al gestor de cuenta) los datos para la etiqueta que faltan. */
export async function requestLabelInfo(u: CurrentUser, projectId: string) {
  const p = await loadProjectRow(projectId);
  if (!p) return;
  const missing = labelInfoMissing(p, await listReferences(projectId));
  if (!missing.length) return;
  await logActivity({ projectId, actorId: u.id, action: "label_info.requested", entity: "project", entityId: projectId, diff: { fields: missing.map((f) => f.label) } });
  await notifyProjectEvent(projectId, "label_info.requested", {
    title: "Fórmula aprobada: completa los datos para la etiqueta",
    intro:
      "El cliente ha aprobado la fórmula. Para preparar la etiqueta y las artes finales necesitamos estos datos del cliente. Complétalos en el proyecto con el botón «Completar datos para la etiqueta»; hasta entonces el proyecto no puede pasar a Diseño.",
    extraRows: [["Falta", missing.map((f) => f.label).join("\n")]],
    to: { requester: true, accountManager: true },
    exclude: u.email,
  });
}

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

// ─── Datos confidenciales (coste objetivo de fórmula) ─────────────────────

/** Coste objetivo de la fórmula. Solo debe llamarse tras comprobar canSeeFormulaCost. */
export async function getFormulaTargetCost(projectId: string, tx: DbOrTx = db): Promise<number | null> {
  const [row] = await tx.select().from(projectConfidential).where(eq(projectConfidential.projectId, projectId));
  return row?.formulaTargetCost != null ? Number(row.formulaTargetCost) : null;
}

/** Guarda el coste objetivo (sin registrar el valor en la actividad, que ve todo el mundo). */
export async function setFormulaTargetCost(u: CurrentUser, projectId: string, value: number | null, tx: DbOrTx = db) {
  if (!canSeeFormulaCost(u)) throw new SheetError("No puedes ver ni editar el coste objetivo de la fórmula");
  if (value != null && (!Number.isFinite(value) || value < 0)) throw new SheetError("Coste objetivo no válido");
  const prev = await getFormulaTargetCost(projectId, tx);
  if (prev === value) return;
  const now = new Date();
  await tx
    .insert(projectConfidential)
    .values({ projectId, formulaTargetCost: value != null ? String(value) : null, updatedBy: u.id, updatedAt: now })
    .onConflictDoUpdate({ target: projectConfidential.projectId, set: { formulaTargetCost: value != null ? String(value) : null, updatedBy: u.id, updatedAt: now } });
  await logActivity({ projectId, actorId: u.id, action: "confidential.updated", entity: "project", entityId: projectId, diff: null }, tx);
}

/** Líneas de texto de un apartado (común o por referencia) para los emails. */
function sectionLines(entries: SheetEntry[], sectionKey: string, ctx: SheetCtx, refs: RefInfo[]) {
  const list = entries.filter((e) => e.section.key === sectionKey);
  if (list.length === 1 && list[0]!.refId === 0) return summarize(list[0]!.section, ctx, list[0]!.data);
  return list.flatMap((e) => {
    const ref = refs.find((r) => r.id === e.refId);
    const lines = summarize(e.section, ctx, e.data);
    return lines.length ? [`— ${ref ? refTitle(ref) : ""}`, ...lines] : [];
  });
}

/** Especificaciones de «Envase y packaging» en líneas de texto (emails), por referencia si procede. */
export async function packagingSummary(p: Project) {
  const { entries, ctx, refs } = await loadSheet(p);
  return sectionLines(entries, "packaging", ctx, refs);
}

/** Resumen del brief para los emails a departamentos (especificaciones del producto y comerciales). */
async function briefSummaryRows(p: Project): Promise<[string, string][]> {
  const [catalog, brandRows, userRows, clientRows] = await Promise.all([
    getCatalogLabels(),
    getBrands(false),
    getActiveUsers(),
    p.clientId ? db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, p.clientId)) : Promise.resolve([]),
  ]);
  const lookups: Lookups = {
    catalog,
    brands: Object.fromEntries(brandRows.map((x) => [x.id, x.name])),
    users: Object.fromEntries(userRows.map((x) => [x.id, x.name])),
    clients: Object.fromEntries(clientRows.map((x) => [x.id, x.name])),
  };
  const b = parseBriefLenient(p.brief).data;
  return briefSections(b, lookups)
    .filter((sec) => sec.step >= 2)
    .flatMap((sec) => sec.rows)
    .filter((r): r is [string, string] => !!r[1]);
}

/**
 * Al entrar en una fase, avisa a cada departamento con apartados que arrancan
 * en ella, con el resumen del proyecto y la información que necesita de otros
 * departamentos. A Laboratorio / I+D le llega además el coste objetivo de la
 * fórmula (confidencial: su email solo va a Laboratorio).
 */
export async function notifyPhaseSections(projectId: string, phase: number) {
  const p = await loadProjectRow(projectId);
  if (!p) return;
  const { entries, ctx, cards, refs } = await loadSheet(p);
  const starting = cards.filter((c) => c.phase === phase);
  if (!starting.length) return;
  const available = cards.filter((c) => c.completed).map((c) => c.dept.name);
  const [briefRows, formulaCost] = await Promise.all([briefSummaryRows(p), starting.some((c) => c.dept.key === "idi") ? getFormulaTargetCost(projectId) : null]);
  const specLines = sectionLines(entries, "packaging", ctx, refs);
  const refRows: [string, string][] = isMulti(refs) ? [["Referencias", refs.map(refTitle).join("\n")]] : [];
  for (const card of starting) {
    const ownEntries = [...card.entries, ...card.refs.flatMap((r) => r.entries)];
    const deps = [...new Set(ownEntries.flatMap((e) => e.section.dependsOn ?? []))];
    const inputRows: [string, string][] = deps.flatMap((key) => {
      const e = entries.find((x) => x.section.key === key);
      if (!e) return [];
      const depCard = cards.find((c) => c.dept.key === e.dept.key);
      const state = depCard ? (depCard.completed ? "completado" : `en «${depCard.current?.name ?? "—"}»`) : "—";
      const lines = sectionLines(entries, key, ctx, refs);
      return [[`${e.title} · ${e.dept.name} · ${state}`, lines.length ? lines.join("\n") : "Sin datos todavía"] as [string, string]];
    });
    const finalName = card.steps.find((s) => s.isFinal)?.name ?? "el estado final";
    await notifyProjectEvent(projectId, "sheet.phase_opened", {
      title: `Fase «${PHASES[phase]?.name}»: tu departamento tiene trabajo`,
      intro: card.perRef
        ? `El proyecto entra en «${PHASES[phase]?.name}». Tiene ${refs.length} referencias y ${card.dept.name} avanza cada una por separado en la ficha; al llegar a «${finalName}» en todas, tu parte queda completada.`
        : `El proyecto entra en «${PHASES[phase]?.name}». Actualiza el estado de ${card.dept.name} en la ficha del proyecto conforme avances; al llegar a «${finalName}» tu parte queda completada.`,
      extraRows: [
        ...(card.dept.key === "idi" && formulaCost != null
          ? ([["Coste objetivo de la fórmula (confidencial)", `${formulaCost.toLocaleString("es-ES", { maximumFractionDigits: 4 })} €/ud`]] as [string, string][])
          : []),
        ...refRows,
        ...briefRows,
        // Si el departamento depende de «Envase y packaging» ya lo recibe abajo con su estado
        ...(specLines.length && !deps.includes("packaging") ? ([["Especificaciones cotizadas", specLines.join("\n")]] as [string, string][]) : []),
        ["Departamentos que ya han completado su parte", available.length ? available.join(" · ") : "—"],
        ...inputRows,
      ],
      to: { departmentKeys: [card.dept.key] },
    });
  }
}

/** Subestado actual (o primero) de cada departamento en varios proyectos (cuenta cada referencia). */
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
        const progs = progress.filter((x) => x.projectId === r.id && x.departmentId === dept.id);
        // Con varias referencias, la fila común (si existe) es anterior a dividir el proyecto
        const rowsToCount = progs.some((x) => x.referenceId) ? progs.filter((x) => x.referenceId) : progs;
        const sids = rowsToCount.length ? rowsToCount.map((x) => x.substateId) : [steps[0]?.id];
        for (const sid of sids) if (sid != null) counts.set(sid, (counts.get(sid) ?? 0) + 1);
      }
      return { dept: dept ?? { id: -1, key, name: key, color: "#77736d", members: [] }, phase, steps: steps.map((s) => ({ ...s, n: counts.get(s.id) ?? 0 })) };
    })
    .filter((x) => x.steps.length);
}

/** Apartados que van por referencia en un proyecto con varias referencias (para la UI). */
export function perReferenceSectionKeys(packagingMode: string) {
  return [...PER_REFERENCE_SECTIONS, ...(packagingMode === "per_reference" ? ["packaging"] : [])];
}
