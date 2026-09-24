import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { departmentMembers, departments, files, gates, projectSheet, projects, users, type Project } from "@/db/schema";
import { needsOlfactory } from "@/lib/brief/schema";
import { PHASES } from "@/lib/labels";
import {
  effectiveData,
  progress,
  requirements,
  sanitizeData,
  SHEET_SECTIONS,
  sectionTitle,
  type Requirement,
  type SheetCtx,
  type SheetData,
  type SheetSection,
  type SheetStatus,
} from "@/lib/sheet/sections";
import { logActivity } from "./activity";
import type { CurrentUser } from "./authz";
import { notifyProjectEvent } from "./notifications";
import { getSettings } from "./settings";

export type SheetDept = { key: string; name: string; color: string; members: string[] };

export type SheetEntry = {
  section: SheetSection;
  title: string;
  dept: SheetDept;
  data: SheetData;
  status: SheetStatus;
  statusBy: string | null;
  statusAt: Date | null;
  statusNote: string | null;
  updatedBy: string | null;
  updatedAt: Date | null;
  reqs: Requirement[];
  done: number;
  total: number;
  complete: boolean;
  /** La fase del proyecto ya ha llegado (o superado) la del apartado. */
  due: boolean;
  closed: boolean;
};

/** Departamento responsable de cada apartado (por defecto o reasignado en el backoffice). */
export async function sectionDeptKeys(): Promise<Record<string, string>> {
  const { sheet_departments } = await getSettings();
  return Object.fromEntries(SHEET_SECTIONS.map((s) => [s.key, sheet_departments?.[s.key] || s.dept]));
}

export async function sheetContext(p: Project, tx: DbOrTx = db): Promise<SheetCtx> {
  const [g2Rows, fileRows] = await Promise.all([
    tx
      .select({ decidedAt: gates.decidedAt, data: gates.data })
      .from(gates)
      .where(and(eq(gates.projectId, p.id), eq(gates.gate, "G2"), eq(gates.status, "approved"))),
    tx
      .select({ tag: files.tag, n: sql<number>`count(*)::int` })
      .from(files)
      .where(eq(files.projectId, p.id))
      .groupBy(files.tag),
  ]);
  const pp = p.prepayment;
  return {
    olfactory: needsOlfactory(p.brief),
    quotedAt: p.quotedAt?.toISOString() ?? null,
    quoteAmount: p.quoteAmount != null ? Number(p.quoteAmount) : null,
    g2At: g2Rows[0]?.decidedAt?.toISOString() ?? null,
    prepayment: pp ? (pp.status === "received" ? "Anticipo recibido" : `Sin anticipo (responsable: ${pp.responsible})`) : null,
    brief: {
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
    db.select({ key: departments.key, name: departments.name, color: departments.color }).from(departments),
    db
      .select({ key: departments.key, name: users.name })
      .from(departmentMembers)
      .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
      .innerJoin(users, eq(users.id, departmentMembers.userId))
      .where(eq(users.status, "active")),
  ]);
  return Object.fromEntries(
    rows.filter((r) => r.key).map((r) => [r.key!, { key: r.key!, name: r.name, color: r.color, members: members.filter((l) => l.key === r.key).map((l) => l.name) }]),
  );
}

/** Ficha técnica completa de un proyecto, evaluada. */
export async function loadSheet(p: Project): Promise<{ ctx: SheetCtx; entries: SheetEntry[] }> {
  const [ctx, rows, depts, deptOf] = await Promise.all([
    sheetContext(p),
    db
      .select({ s: projectSheet, statusBy: users.name })
      .from(projectSheet)
      .leftJoin(users, eq(users.id, projectSheet.statusBy))
      .where(eq(projectSheet.projectId, p.id)),
    deptsByKey(),
    sectionDeptKeys(),
  ]);
  const updaters = new Map(
    (
      await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(sql`${users.id} in (select updated_by from project_sheet where project_id = ${p.id})`)
    ).map((x) => [x.id, x.name]),
  );
  const closed = ["rejected", "cancelled"].includes(p.status);
  const entries = SHEET_SECTIONS.map((section): SheetEntry => {
    const row = rows.find((r) => r.s.section === section.key);
    const data = effectiveData(section, ctx, row?.s.data);
    const reqs = requirements(section, ctx, data);
    const pr = progress(reqs);
    const key = deptOf[section.key]!;
    return {
      section,
      title: sectionTitle(section, ctx),
      dept: depts[key] ?? { key, name: key, color: "#77736d", members: [] },
      data,
      status: row?.s.status ?? "pending",
      statusBy: row?.statusBy ?? null,
      statusAt: row?.s.statusAt ?? null,
      statusNote: row?.s.statusNote ?? null,
      updatedBy: row?.s.updatedBy ? (updaters.get(row.s.updatedBy) ?? null) : null,
      updatedAt: row?.s.updatedAt ?? null,
      reqs,
      ...pr,
      due: p.status === "in_production" || (p.status !== "draft" && p.phase >= section.phase),
      closed,
    };
  });
  return { ctx, entries };
}

/**
 * ¿Puede editar el apartado y marcarlo como terminado? Solo los miembros del
 * departamento del apartado, el decisor global y los administradores. El resto lo ve.
 */
export function canEditSection(u: CurrentUser, deptKey: string, p: Pick<Project, "status" | "phase">) {
  if (!["in_progress", "paused", "in_production"].includes(p.status)) return false;
  if (p.status === "in_progress" && p.phase < 1) return false;
  return u.roles.includes("admin") || u.roles.includes("global_decider") || u.departmentKeys.includes(deptKey);
}

/** Apartados de fases ya alcanzadas que siguen sin terminar (aviso al avanzar de fase). */
export function pendingUpTo(entries: SheetEntry[], phase: number) {
  return entries.filter((e) => e.section.phase <= phase && e.status === "pending");
}

/** Apartados que arrancan en una fase: para avisar a sus departamentos al entrar en ella. */
export async function sectionsStartingAt(phase: number) {
  const deptOf = await sectionDeptKeys();
  return SHEET_SECTIONS.filter((s) => s.phase === phase).map((s) => ({ key: s.key, title: s.title, dept: deptOf[s.key]!, phaseName: PHASES[phase]?.name ?? "" }));
}

export async function loadProjectRow(projectId: string, tx: DbOrTx = db) {
  const [p] = await tx.select().from(projects).where(eq(projects.id, projectId));
  return p ?? null;
}

// ─── Mutaciones ───────────────────────────────────────────────────────────

export class SheetError extends Error {}

function changedLabels(section: SheetSection, before: SheetData, after: SheetData) {
  const labels: string[] = [];
  for (const f of section.groups.flatMap((g) => g.fields)) {
    if (f.type === "files") continue;
    if (JSON.stringify(before[f.key] ?? null) !== JSON.stringify(after[f.key] ?? null)) labels.push(f.label);
  }
  return labels;
}

async function guard(u: CurrentUser, projectId: string, sectionKey: string) {
  const section = SHEET_SECTIONS.find((s) => s.key === sectionKey);
  if (!section) throw new SheetError("Apartado desconocido");
  const p = await loadProjectRow(projectId);
  if (!p) throw new SheetError("Proyecto no encontrado");
  const deptKey = (await sectionDeptKeys())[section.key]!;
  if (!canEditSection(u, deptKey, p)) throw new SheetError("Solo los miembros del departamento pueden editar este apartado");
  return { section, p, deptKey };
}

export async function saveSection(u: CurrentUser, projectId: string, sectionKey: string, raw: unknown) {
  const { section, p } = await guard(u, projectId, sectionKey);
  const clean = sanitizeData(section, raw);
  const ctx = await sheetContext(p);
  const [prev] = await db
    .select()
    .from(projectSheet)
    .where(and(eq(projectSheet.projectId, projectId), eq(projectSheet.section, sectionKey)));
  const before = effectiveData(section, ctx, prev?.data);
  const changes = changedLabels(section, before, clean);
  // Si estaba terminado y ahora le falta algo obligatorio, vuelve a pendiente
  const stillComplete = progress(requirements(section, ctx, effectiveData(section, ctx, clean))).complete;
  const reopen = prev?.status === "done" && !stillComplete;
  const now = new Date();
  await db
    .insert(projectSheet)
    .values({ projectId, section: sectionKey, data: clean, updatedBy: u.id, updatedAt: now })
    .onConflictDoUpdate({
      target: [projectSheet.projectId, projectSheet.section],
      set: { data: clean, updatedBy: u.id, updatedAt: now, ...(reopen ? { status: "pending" as const, statusBy: u.id, statusAt: now, statusNote: null } : {}) },
    });
  if (changes.length || !prev) {
    await logActivity({
      projectId,
      actorId: u.id,
      action: "sheet.updated",
      entity: "project_sheet",
      entityId: sectionKey,
      diff: { section: sectionKey, title: sectionTitle(section, ctx), fields: changes, reopened: reopen },
    });
  }
  return { reopened: reopen };
}

export async function setSectionStatus(u: CurrentUser, projectId: string, sectionKey: string, status: SheetStatus, note?: string | null) {
  const { section, p, deptKey } = await guard(u, projectId, sectionKey);
  const ctx = await sheetContext(p);
  const [prev] = await db
    .select()
    .from(projectSheet)
    .where(and(eq(projectSheet.projectId, projectId), eq(projectSheet.section, sectionKey)));
  const text = note?.trim() || null;
  if (status === "done") {
    const reqs = requirements(section, ctx, effectiveData(section, ctx, prev?.data));
    const missing = reqs.filter((r) => !r.ok).map((r) => r.label);
    if (missing.length) throw new SheetError(`Falta por completar: ${missing.join("; ")}`);
  }
  if (status === "na" && !text) throw new SheetError("Indica por qué este apartado no aplica al proyecto");
  const now = new Date();
  // Al marcar terminado se guardan también los valores precargados del brief
  const data = prev?.data ?? effectiveData(section, ctx, null);
  await db
    .insert(projectSheet)
    .values({ projectId, section: sectionKey, data, status, statusBy: u.id, statusAt: now, statusNote: text, updatedBy: u.id, updatedAt: now })
    .onConflictDoUpdate({
      target: [projectSheet.projectId, projectSheet.section],
      set: { status, statusBy: u.id, statusAt: now, statusNote: text },
    });
  const title = sectionTitle(section, ctx);
  const action = status === "done" ? "sheet.done" : status === "na" ? "sheet.na" : "sheet.reopened";
  await logActivity({ projectId, actorId: u.id, action, entity: "project_sheet", entityId: sectionKey, diff: { section: sectionKey, title, note: text } });

  if (status !== "pending") {
    const { entries } = await loadSheet(p);
    const phaseLeft = entries.filter((e) => e.section.phase <= p.phase && e.status === "pending");
    const [dept] = await db.select({ name: departments.name }).from(departments).where(eq(departments.key, deptKey));
    await notifyProjectEvent(projectId, action, {
      title: status === "done" ? `${dept?.name ?? deptKey} ha completado «${title}»` : `«${title}» no aplica`,
      intro:
        status === "done"
          ? `El apartado «${title}» de la ficha técnica está terminado y disponible para el resto de departamentos.`
          : `${u.name} ha marcado el apartado «${title}» como no aplicable.`,
      message: text ? { label: "Motivo", body: text } : null,
      extraRows: [
        [
          "Ficha técnica",
          phaseLeft.length ? `Pendiente en esta fase: ${phaseLeft.map((e) => `${e.title} (${e.dept.name})`).join(", ")}` : "Todo lo de la fase actual está completo: el proyecto puede avanzar.",
        ],
      ],
      to: { requester: true, accountManager: true, departmentKeys: ["marketing"] },
    });
  }
}

/**
 * Al entrar en una fase, avisa a cada departamento con apartados que arrancan
 * en ella, con el resumen de lo que ya está disponible en la ficha.
 */
export async function notifyPhaseSections(projectId: string, phase: number) {
  const p = await loadProjectRow(projectId);
  if (!p) return;
  const starting = await sectionsStartingAt(phase);
  if (!starting.length) return;
  const { entries } = await loadSheet(p);
  const available = entries.filter((e) => e.status === "done").map((e) => `${e.title} (${e.dept.name})`);
  const byDept = new Map<string, string[]>();
  for (const s of starting) {
    const title = entries.find((e) => e.section.key === s.key)?.title ?? s.title;
    byDept.set(s.dept, [...(byDept.get(s.dept) ?? []), title]);
  }
  for (const [dept, titles] of byDept) {
    await notifyProjectEvent(projectId, "sheet.phase_opened", {
      title: `Fase «${PHASES[phase]?.name}»: tu departamento tiene trabajo`,
      intro: `El proyecto entra en «${PHASES[phase]?.name}». Tu departamento debe completar en la ficha técnica: ${titles.map((t) => `«${t}»`).join(", ")}. Al terminar, márcalo como terminado en la ficha del proyecto.`,
      extraRows: [["Ya disponible en la ficha", available.length ? available.join(" · ") : "—"]],
      to: { departmentKeys: [dept] },
    });
  }
}
