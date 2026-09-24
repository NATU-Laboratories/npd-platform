import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  clients,
  departments,
  gates,
  infoRequests,
  projectCodeCounters,
  projectDepartments,
  projects,
  type GateKey,
  type Prepayment,
  type Project,
  type ProjectStatus,
} from "@/db/schema";
import { computeCompleteness, FIELD_BY_KEY, submitErrors } from "@/lib/brief/fields";
import { LAST_PHASE, PHASES, PREPAYMENT_TYPES } from "@/lib/labels";
import { parseBriefLenient, type BriefData } from "@/lib/brief/schema";
import { logActivity, jsonDiff } from "./activity";
import { canDecideGate, canEditBrief, canManageProject, canRequest, canSendQuote, type CurrentUser } from "./authz";
import { enqueueJob, kickJobs } from "./jobs";
import {
  notifyApproved,
  notifyProjectEvent,
  notifyInfoAnswered,
  notifyInfoRequested,
  notifyStatusChange,
  notifySubmitted,
} from "./notifications";

/**
 * Máquina de estados de proyectos (§9.3 notas): único punto donde se cambian
 * estados. Valida permisos y transición, escribe activity_log y dispara
 * notificaciones.
 */

export class ActionError extends Error {
  constructor(
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "ActionError";
  }
}

type Transition =
  | "submit"
  | "approve"
  | "request_info"
  | "answer_info"
  | "reject"
  | "pause"
  | "resume"
  | "cancel"
  | "send_quote"
  | "budget_decision"
  | "advance";

const ALLOWED: Record<Transition, ProjectStatus[]> = {
  submit: ["draft"],
  approve: ["submitted", "info_requested"],
  request_info: ["submitted", "info_requested"],
  answer_info: ["info_requested"],
  reject: ["submitted", "info_requested"],
  pause: ["submitted", "info_requested", "in_progress"],
  resume: ["paused"],
  cancel: ["in_progress", "paused"],
  send_quote: ["in_progress"],
  budget_decision: ["in_progress"],
  advance: ["in_progress"],
};

/** Fase en la que se permite cada transición (si aplica). */
const PHASE_OF: Partial<Record<Transition, (phase: number) => boolean>> = {
  approve: (ph) => ph === 0,
  request_info: (ph) => ph === 0,
  reject: (ph) => ph === 0,
  send_quote: (ph) => ph === 1,
  budget_decision: (ph) => ph === 2,
  advance: (ph) => ph >= 3 && ph <= LAST_PHASE,
};

export function canTransition(status: ProjectStatus, t: Transition, phase?: number) {
  if (!ALLOWED[t].includes(status)) return false;
  const phaseOk = PHASE_OF[t];
  return phase === undefined || !phaseOk || phaseOk(phase);
}

function assertTransition(p: Project, t: Transition) {
  if (!canTransition(p.status, t, p.phase)) throw new ActionError(`Acción no permitida en el estado actual del proyecto`);
}

async function loadForUpdate(tx: Tx, projectId: string) {
  const [p] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
  if (!p) throw new ActionError("Proyecto no encontrado");
  return p;
}

/** Puerta de aprobación de la fase actual (solo fases 0 y 2 tienen puerta). */
export function currentGate(p: Pick<Project, "phase">): GateKey | null {
  return (PHASES[p.phase]?.gate as GateKey | null) ?? null;
}

/** Columnas desnormalizadas a partir del brief (filtros y KPIs, §9.3). */
function columnsFromBrief(b: BriefData) {
  const isPL = b.type === "PL" || b.type === "MDD"; // tipos con cliente
  return {
    name: b.name ?? "",
    type: b.type ?? null,
    category: b.category ?? null,
    subtype: isPL ? (b.subtype ?? null) : null,
    brandId: b.type === "MP" ? (b.brandId ?? null) : null,
    clientId: isPL ? (b.clientId ?? null) : (b.linkedClientId ?? null),
    accountManagerId: isPL ? (b.accountManagerId ?? null) : null,
    origin: b.type === "MP" ? (b.origin ?? null) : null,
    priority: b.priority ?? null,
    neededBy: b.neededBy ?? null,
    neededByReason: b.neededByReason ?? null,
    unitsFirstOrder: isPL ? (b.firstOrderUnits ?? null) : null,
    unitsAnnual: b.annualUnits ?? null,
    targetPrice: isPL && b.targetPrice != null ? String(b.targetPrice) : null,
    completenessPct: computeCompleteness(b),
  };
}

// ─── Borradores ───────────────────────────────────────────────────────────

export async function createDraft(u: CurrentUser) {
  if (!canRequest(u)) throw new ActionError("No tienes permiso para crear solicitudes");
  const [p] = await db
    .insert(projects)
    .values({ requesterId: u.id, accountManagerId: u.id, status: "draft", brief: { accountManagerId: u.id } })
    .returning({ id: projects.id });
  await logActivity({ projectId: p!.id, actorId: u.id, action: "project.created", entity: "project", entityId: p!.id });
  return p!.id;
}

/**
 * Guarda el brief. En borrador: autoguardado silencioso. Tras el envío: edición
 * auditada con diff de campos (valor anterior → nuevo, §7.2).
 */
export async function saveBrief(u: CurrentUser, projectId: string, input: unknown) {
  const { data, errors } = parseBriefLenient(input);
  return db.transaction(async (tx) => {
    const p = await loadForUpdate(tx, projectId);
    if (!canEditBrief(u, p)) throw new ActionError("No puedes editar este proyecto");
    if (p.status !== "draft") {
      // Tipo y categoría definen el flujo: no se cambian tras el envío.
      data.type = p.brief.type;
      data.category = p.brief.category;
    }
    const cols = columnsFromBrief(data);
    if (p.status !== "draft" && data.newClient && !data.clientId) {
      data.clientId = await createClient(tx, data);
      cols.clientId = data.clientId;
      delete data.newClient;
    }
    await tx
      .update(projects)
      .set({ ...cols, brief: data, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    if (p.status !== "draft") {
      const diff = jsonDiff(p.brief, data);
      if (Object.keys(diff).length) {
        await logActivity({ projectId, actorId: u.id, action: "project.edited", entity: "project", entityId: projectId, diff }, tx);
      }
    }
    return { completeness: cols.completenessPct, errors };
  });
}

async function createClient(tx: Tx, b: BriefData) {
  const nc = b.newClient!;
  const [c] = await tx
    .insert(clients)
    .values({ name: nc.name, country: nc.country ?? null, contact: nc.contact ?? null, accountManagerUserId: b.accountManagerId ?? null })
    .returning({ id: clients.id });
  return c!.id;
}

async function nextCode(tx: Tx, type: "PL" | "MP" | "MDD") {
  const year = Number(new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid", year: "numeric" }));
  const [row] = await tx
    .insert(projectCodeCounters)
    .values({ year, type, last: 1 })
    .onConflictDoUpdate({
      target: [projectCodeCounters.year, projectCodeCounters.type],
      set: { last: sql`${projectCodeCounters.last} + 1` },
    })
    .returning({ last: projectCodeCounters.last });
  return `${year}-${type}-${String(row!.last).padStart(4, "0")}`;
}

/** Paso 5: envío. Estado → Solicitado, código, carpeta SharePoint, notificación. */
export async function submitProject(u: CurrentUser, projectId: string) {
  const result = await db.transaction(async (tx) => {
    const p = await loadForUpdate(tx, projectId);
    if (p.requesterId !== u.id) throw new ActionError("Solo el autor puede enviar el borrador");
    assertTransition(p, "submit");
    const brief = { ...p.brief };
    const errs = submitErrors(brief);
    if (Object.keys(errs).length) throw new ActionError("Faltan campos obligatorios", errs);

    if ((brief.type === "PL" || brief.type === "MDD") && brief.newClient && !brief.clientId) {
      brief.clientId = await createClient(tx, brief);
      delete brief.newClient;
    }
    const code = await nextCode(tx, brief.type!);
    const now = new Date();
    await tx
      .update(projects)
      .set({ ...columnsFromBrief(brief), brief, code, status: "submitted", requestedAt: now, updatedAt: now })
      .where(eq(projects.id, projectId));
    await tx.insert(gates).values({ projectId, gate: "G1", status: "pending" }).onConflictDoNothing();
    await logActivity({ projectId, actorId: u.id, action: "project.submitted", entity: "project", entityId: projectId, diff: { code } }, tx);
    const jobId = await enqueueJob("sharepoint.provision", { projectId }, tx);
    return { code, jobId };
  });
  // Tras confirmar en BD: nada de lo siguiente puede perder la solicitud.
  kickJobs([result.jobId]);
  await notifySubmitted(projectId);
  return result.code;
}

// ─── Puerta G1 ────────────────────────────────────────────────────────────

export type GateDecision =
  | { kind: "approve"; templateId?: number | null; departmentIds: number[]; comment?: string | null }
  | { kind: "request_info"; message: string; fields: string[] }
  | { kind: "reject"; reasonCode: string; reasonText?: string | null }
  | { kind: "pause"; reason: string };

export async function decideGate(u: CurrentUser, projectId: string, decision: GateDecision) {
  const effects = await db.transaction(async (tx) => {
    const p = await loadForUpdate(tx, projectId);
    const gate = currentGate(p);
    if (gate !== "G1") throw new ActionError("La solicitud no está pendiente de aprobación");
    if (!canDecideGate(u, p, gate)) throw new ActionError("No eres decisor de esta puerta");
    assertTransition(p, decision.kind);

    const [g] = await tx
      .insert(gates)
      .values({ projectId, gate, status: "pending" })
      .onConflictDoUpdate({ target: [gates.projectId, gates.gate], set: { projectId } })
      .returning();
    const now = new Date();
    const decided = { decidedBy: u.id, decidedAt: now };

    switch (decision.kind) {
      case "approve": {
        const deptIds = [...new Set(decision.departmentIds)];
        if (!deptIds.length) throw new ActionError("Selecciona al menos un departamento");
        const valid = await tx.select({ id: departments.id }).from(departments).where(and(inArray(departments.id, deptIds), eq(departments.isActive, true)));
        if (valid.length !== deptIds.length) throw new ActionError("Departamento no válido");
        await tx.update(gates).set({ ...decided, status: "approved", comment: decision.comment ?? null }).where(eq(gates.id, g!.id));
        await tx
          .update(projects)
          .set({ status: "in_progress", phase: 1, decidedG1At: now, templateId: decision.templateId ?? null, updatedAt: now }) // → Cotización
          .where(eq(projects.id, projectId));
        await tx.delete(projectDepartments).where(eq(projectDepartments.projectId, projectId));
        await tx.insert(projectDepartments).values(deptIds.map((departmentId) => ({ projectId, departmentId })));
        await tx.insert(gates).values({ projectId, gate: "G2", status: "pending" }).onConflictDoNothing();
        await logActivity(
          { projectId, actorId: u.id, action: "gate.approved", entity: "gate", entityId: gate, diff: { gate, departmentIds: deptIds, templateId: decision.templateId ?? null, comment: decision.comment ?? null } },
          tx,
        );
        return () => notifyApproved(projectId, deptIds, decision.comment);
      }
      case "request_info": {
        const message = decision.message.trim();
        if (!message) throw new ActionError("Indica qué información falta", { message: "Obligatorio" });
        const fields = decision.fields.filter((f) => FIELD_BY_KEY[f]);
        await tx.update(gates).set({ ...decided, status: "info_requested", comment: message }).where(eq(gates.id, g!.id));
        const [ir] = await tx
          .insert(infoRequests)
          .values({ projectId, gateId: g!.id, requestedBy: u.id, message, fieldsMissing: fields })
          .returning({ id: infoRequests.id });
        await tx.update(projects).set({ status: "info_requested", updatedAt: now }).where(eq(projects.id, projectId));
        await logActivity({ projectId, actorId: u.id, action: "gate.info_requested", entity: "info_request", entityId: ir!.id, diff: { gate, message, fields } }, tx);
        return () => notifyInfoRequested(projectId, ir!.id);
      }
      case "reject": {
        if (!decision.reasonCode) throw new ActionError("El motivo es obligatorio", { reasonCode: "Obligatorio" });
        if (decision.reasonCode === "otro" && !decision.reasonText?.trim()) throw new ActionError("Explica el motivo", { reasonText: "Obligatorio" });
        await tx
          .update(gates)
          .set({ ...decided, status: "rejected", reasonCode: decision.reasonCode, comment: decision.reasonText ?? null })
          .where(eq(gates.id, g!.id));
        await tx.update(projects).set({ status: "rejected", closedAt: now, updatedAt: now }).where(eq(projects.id, projectId));
        await logActivity(
          { projectId, actorId: u.id, action: "gate.rejected", entity: "gate", entityId: gate, diff: { gate, reasonCode: decision.reasonCode, reasonText: decision.reasonText ?? null } },
          tx,
        );
        const reason = await reasonLabel(decision.reasonCode, decision.reasonText);
        return () => notifyStatusChange(projectId, "gate.rejected", reason);
      }
      case "pause": {
        const reason = decision.reason.trim();
        if (!reason) throw new ActionError("El motivo es obligatorio", { reason: "Obligatorio" });
        await tx.update(gates).set({ ...decided, status: "paused", comment: reason }).where(eq(gates.id, g!.id));
        await tx
          .update(projects)
          .set({ status: "paused", statusBeforePause: p.status, updatedAt: now })
          .where(eq(projects.id, projectId));
        await logActivity({ projectId, actorId: u.id, action: "gate.paused", entity: "gate", entityId: gate, diff: { gate, reason } }, tx);
        return () => notifyStatusChange(projectId, "gate.paused", reason);
      }
    }
  });
  await effects();
}

async function reasonLabel(code: string, text?: string | null) {
  const { getCatalog } = await import("./catalogs");
  const opt = (await getCatalog("rejection_reason")).find((o) => o.value === code);
  return [opt?.label ?? code, text].filter(Boolean).join(" — ");
}

/** El solicitante responde a la petición de información → vuelve a Solicitado. */
export async function answerInfoRequest(u: CurrentUser, projectId: string, answer: string) {
  const irId = await db.transaction(async (tx) => {
    const p = await loadForUpdate(tx, projectId);
    if (p.requesterId !== u.id && p.accountManagerId !== u.id) throw new ActionError("Solo el solicitante puede responder");
    assertTransition(p, "answer_info");
    const text = answer.trim();
    if (!text) throw new ActionError("Escribe una respuesta", { answer: "Obligatorio" });
    const errs = submitErrors(p.brief);
    if (Object.keys(errs).length) throw new ActionError("Faltan campos obligatorios en el brief", errs);
    const [ir] = await tx
      .update(infoRequests)
      .set({ answeredBy: u.id, answeredAt: new Date(), answer: text })
      .where(and(eq(infoRequests.projectId, projectId), isNull(infoRequests.answeredAt)))
      .returning({ id: infoRequests.id });
    await tx.update(gates).set({ status: "pending" }).where(and(eq(gates.projectId, projectId), eq(gates.gate, "G1")));
    await tx.update(projects).set({ status: "submitted", updatedAt: new Date() }).where(eq(projects.id, projectId));
    await logActivity({ projectId, actorId: u.id, action: "info.answered", entity: "info_request", entityId: ir?.id ?? null, diff: { answer: text } }, tx);
    return ir?.id;
  });
  if (irId) await notifyInfoAnswered(projectId, irId);
}

export async function resumeProject(u: CurrentUser, projectId: string, comment?: string) {
  await db.transaction(async (tx) => {
    const p = await loadForUpdate(tx, projectId);
    if (!canManageProject(u, p)) throw new ActionError("No puedes reanudar este proyecto");
    assertTransition(p, "resume");
    const back = p.statusBeforePause ?? (p.phase === 0 ? "submitted" : "in_progress");
    await tx.update(projects).set({ status: back, statusBeforePause: null, updatedAt: new Date() }).where(eq(projects.id, projectId));
    const gate = currentGate(p);
    if (gate) {
      await tx
        .update(gates)
        .set({ status: "pending" })
        .where(and(eq(gates.projectId, projectId), eq(gates.gate, gate), eq(gates.status, "paused")));
    }
    await logActivity({ projectId, actorId: u.id, action: "project.resumed", entity: "project", entityId: projectId, diff: { to: back, comment: comment ?? null } }, tx);
  });
  await notifyStatusChange(projectId, "project.resumed", comment);
}

export async function cancelProject(u: CurrentUser, projectId: string, reason: string) {
  await db.transaction(async (tx) => {
    const p = await loadForUpdate(tx, projectId);
    if (!canManageProject(u, p)) throw new ActionError("No puedes cancelar este proyecto");
    assertTransition(p, "cancel");
    if (!reason.trim()) throw new ActionError("El motivo es obligatorio", { reason: "Obligatorio" });
    await tx.update(projects).set({ status: "cancelled", closedAt: new Date(), updatedAt: new Date() }).where(eq(projects.id, projectId));
    await logActivity({ projectId, actorId: u.id, action: "project.cancelled", entity: "project", entityId: projectId, diff: { reason } }, tx);
  });
  await notifyStatusChange(projectId, "project.cancelled", reason);
}

export async function deleteDraft(u: CurrentUser, projectId: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p || p.status !== "draft" || p.requesterId !== u.id) throw new ActionError("No se puede eliminar");
  await db.delete(projects).where(eq(projects.id, projectId));
  if (p.stagingFolderId) {
    const { getStorage } = await import("@/lib/graph/storage");
    await getStorage()
      .deleteItem(p.stagingFolderId)
      .catch(() => undefined);
  }
}

/** Pausa fuera de la decisión de puerta (proyecto en curso). */
export async function pauseProject(u: CurrentUser, projectId: string, reason: string) {
  await db.transaction(async (tx) => {
    const p = await loadForUpdate(tx, projectId);
    if (!canManageProject(u, p)) throw new ActionError("No puedes pausar este proyecto");
    assertTransition(p, "pause");
    if (!reason.trim()) throw new ActionError("El motivo es obligatorio", { reason: "Obligatorio" });
    await tx
      .update(projects)
      .set({ status: "paused", statusBeforePause: p.status, updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    await logActivity({ projectId, actorId: u.id, action: "gate.paused", entity: "project", entityId: projectId, diff: { reason } }, tx);
  });
  await notifyStatusChange(projectId, "gate.paused", reason);
}

// ─── Cotización (fase 1 → 2) ──────────────────────────────────────────────

export async function sendQuote(u: CurrentUser, projectId: string, input: { amount?: number | null; comment?: string | null }) {
  const amount = input.amount != null && Number.isFinite(input.amount) && input.amount >= 0 ? input.amount : null;
  const comment = input.comment?.trim() || null;
  await db.transaction(async (tx) => {
    const p = await loadForUpdate(tx, projectId);
    if (!canSendQuote(u, p)) throw new ActionError("No puedes enviar la cotización de este proyecto");
    assertTransition(p, "send_quote");
    const now = new Date();
    await tx
      .update(projects)
      .set({ phase: 2, quoteAmount: amount != null ? String(amount) : null, quotedAt: now, updatedAt: now })
      .where(eq(projects.id, projectId));
    await tx
      .insert(gates)
      .values({ projectId, gate: "G2", status: "pending", openedAt: now })
      .onConflictDoUpdate({ target: [gates.projectId, gates.gate], set: { status: "pending", openedAt: now, decidedBy: null, decidedAt: null } });
    await logActivity({ projectId, actorId: u.id, action: "quote.sent", entity: "project", entityId: projectId, diff: { amount, comment } }, tx);
  });
  const extra: [string, string][] = amount != null ? [["Importe cotizado", amount.toLocaleString("es-ES", { style: "currency", currency: "EUR" })]] : [];
  await notifyProjectEvent(projectId, "quote.sent", {
    title: "Cotización enviada al cliente",
    intro: "El proyecto pasa a Valoración con cliente. Cuando el cliente responda, registra la decisión (G2 · Aprobación del presupuesto).",
    message: comment ? { label: "Comentario", body: comment } : null,
    extraRows: extra,
    to: { requester: true, accountManager: true, deciders: "G2" },
  });
}

// ─── Puerta G2: aprobación del presupuesto por el cliente ─────────────────

export type BudgetDecision =
  | {
      kind: "approve";
      comment?: string | null;
      /** Obligatorio en PL. */
      prepayment?: { mode: "received" | "waived"; responsible?: string | null; accepted?: boolean; note?: string | null } | null;
    }
  | { kind: "changes"; reason: string }
  | { kind: "reject"; reasonCode: string; reasonText?: string | null }
  | { kind: "pause"; reason: string };

export async function decideBudget(u: CurrentUser, projectId: string, decision: BudgetDecision) {
  const effect = await db.transaction(async (tx) => {
    const p = await loadForUpdate(tx, projectId);
    if (!canDecideGate(u, p, "G2")) throw new ActionError("No eres aprobador del presupuesto (G2) para este tipo de proyecto");
    assertTransition(p, "budget_decision");
    const now = new Date();
    const [g] = await tx
      .insert(gates)
      .values({ projectId, gate: "G2", status: "pending" })
      .onConflictDoUpdate({ target: [gates.projectId, gates.gate], set: { projectId } })
      .returning();
    const decided = { decidedBy: u.id, decidedAt: now };

    switch (decision.kind) {
      case "approve": {
        let prepayment: Prepayment | null = null;
        if (PREPAYMENT_TYPES.includes(p.type ?? "")) {
          const pp = decision.prepayment;
          if (!pp) throw new ActionError("Indica si se ha recibido el anticipo del 30 %", { prepayment: "Obligatorio" });
          if (pp.mode === "waived") {
            const responsible = pp.responsible?.trim();
            if (!responsible) throw new ActionError("Indica quién se hace responsable de iniciar sin anticipo", { responsible: "Obligatorio" });
            if (!pp.accepted) throw new ActionError("El responsable debe aceptar iniciar el proyecto sin el anticipo", { accepted: "Obligatorio" });
            prepayment = { status: "waived", responsible, recordedBy: u.name, recordedAt: now.toISOString(), note: pp.note?.trim() || undefined };
          } else {
            prepayment = { status: "received", recordedBy: u.name, recordedAt: now.toISOString(), receivedAt: now.toISOString(), note: pp.note?.trim() || undefined };
          }
        }
        await tx
          .update(gates)
          .set({ ...decided, status: "approved", comment: decision.comment?.trim() || null, data: prepayment ? { prepayment } : null })
          .where(eq(gates.id, g!.id));
        await tx.update(projects).set({ phase: 3, prepayment, updatedAt: now }).where(eq(projects.id, projectId));
        await logActivity(
          { projectId, actorId: u.id, action: "gate.approved", entity: "gate", entityId: "G2", diff: { gate: "G2", comment: decision.comment ?? null, prepayment } },
          tx,
        );
        const ppText =
          prepayment?.status === "received"
            ? "Anticipo del 30 % recibido."
            : prepayment?.status === "waived"
              ? `Se inicia SIN anticipo del 30 % bajo la responsabilidad de ${prepayment.responsible}.`
              : null;
        return () =>
          notifyProjectEvent(projectId, "gate.approved.g2", {
            title: "Presupuesto aprobado por el cliente",
            intro: "El proyecto pasa a En curso.",
            message: [decision.comment?.trim(), ppText].filter(Boolean).length
              ? { label: "Detalle", body: [ppText, decision.comment?.trim()].filter(Boolean).join("\n") }
              : null,
            to: { requester: true, accountManager: true, departments: true },
          });
      }
      case "changes": {
        const reason = decision.reason.trim();
        if (!reason) throw new ActionError("Indica qué cambios pide el cliente", { reason: "Obligatorio" });
        await tx.update(gates).set({ ...decided, status: "recycled", comment: reason }).where(eq(gates.id, g!.id));
        await tx.update(projects).set({ phase: 1, updatedAt: now }).where(eq(projects.id, projectId));
        await logActivity({ projectId, actorId: u.id, action: "gate.recycled", entity: "gate", entityId: "G2", diff: { gate: "G2", reason } }, tx);
        return () =>
          notifyProjectEvent(projectId, "gate.recycled", {
            title: "El cliente pide cambios en la cotización",
            intro: "El proyecto vuelve a la fase de Cotización.",
            message: { label: "Cambios solicitados", body: reason },
            to: { requester: true, accountManager: true, departments: true },
          });
      }
      case "reject": {
        if (!decision.reasonCode) throw new ActionError("El motivo es obligatorio", { reasonCode: "Obligatorio" });
        if (decision.reasonCode === "otro" && !decision.reasonText?.trim()) throw new ActionError("Explica el motivo", { reasonText: "Obligatorio" });
        await tx
          .update(gates)
          .set({ ...decided, status: "rejected", reasonCode: decision.reasonCode, comment: decision.reasonText ?? null })
          .where(eq(gates.id, g!.id));
        await tx.update(projects).set({ status: "rejected", closedAt: now, updatedAt: now }).where(eq(projects.id, projectId));
        await logActivity(
          { projectId, actorId: u.id, action: "gate.rejected", entity: "gate", entityId: "G2", diff: { gate: "G2", reasonCode: decision.reasonCode, reasonText: decision.reasonText ?? null } },
          tx,
        );
        const reason = await reasonLabel(decision.reasonCode, decision.reasonText);
        return () => notifyStatusChange(projectId, "gate.rejected", reason);
      }
      case "pause": {
        const reason = decision.reason.trim();
        if (!reason) throw new ActionError("El motivo es obligatorio", { reason: "Obligatorio" });
        await tx.update(gates).set({ ...decided, status: "paused", comment: reason }).where(eq(gates.id, g!.id));
        await tx.update(projects).set({ status: "paused", statusBeforePause: p.status, updatedAt: now }).where(eq(projects.id, projectId));
        await logActivity({ projectId, actorId: u.id, action: "gate.paused", entity: "gate", entityId: "G2", diff: { gate: "G2", reason } }, tx);
        return () => notifyStatusChange(projectId, "gate.paused", reason);
      }
    }
  });
  await effect();
}

/** Registrar más tarde el anticipo de un proyecto PL iniciado sin él. */
export async function markPrepaymentReceived(u: CurrentUser, projectId: string, note?: string) {
  await db.transaction(async (tx) => {
    const p = await loadForUpdate(tx, projectId);
    if (!canManageProject(u, p) && !canDecideGate(u, p, "G2")) throw new ActionError("No puedes registrar el anticipo");
    if (p.prepayment?.status !== "waived") throw new ActionError("El proyecto no está pendiente de anticipo");
    const now = new Date().toISOString();
    const prepayment: Prepayment = { ...p.prepayment, status: "received", receivedAt: now, note: note?.trim() || p.prepayment.note };
    await tx.update(projects).set({ prepayment, updatedAt: new Date() }).where(eq(projects.id, projectId));
    await logActivity({ projectId, actorId: u.id, action: "prepayment.received", entity: "project", entityId: projectId, diff: { note: note ?? null } }, tx);
  });
}

// ─── Fases 3 → 6 y paso a producción ──────────────────────────────────────

export async function advancePhase(u: CurrentUser, projectId: string, comment?: string) {
  const result = await db.transaction(async (tx) => {
    const p = await loadForUpdate(tx, projectId);
    if (!canManageProject(u, p)) throw new ActionError("No puedes avanzar la fase de este proyecto");
    assertTransition(p, "advance");
    const now = new Date();
    const text = comment?.trim() || null;
    if (p.phase === LAST_PHASE) {
      await tx.update(projects).set({ status: "in_production", closedAt: now, updatedAt: now }).where(eq(projects.id, projectId));
      await logActivity({ projectId, actorId: u.id, action: "project.in_production", entity: "project", entityId: projectId, diff: { comment: text } }, tx);
      return { to: "producción", done: true, comment: text };
    }
    const next = p.phase + 1;
    await tx.update(projects).set({ phase: next, updatedAt: now }).where(eq(projects.id, projectId));
    await logActivity(
      { projectId, actorId: u.id, action: "phase.advanced", entity: "project", entityId: projectId, diff: { from: p.phase, to: next, comment: text } },
      tx,
    );
    return { to: PHASES[next]!.name, done: false, comment: text };
  });
  await notifyProjectEvent(projectId, result.done ? "project.in_production" : "phase.advanced", {
    title: result.done ? "Proyecto en producción" : `Nueva fase: ${result.to}`,
    intro: result.done ? "El proyecto ha superado la preparación y pasa a producción." : `El proyecto avanza a la fase «${result.to}».`,
    message: result.comment ? { label: "Comentario", body: result.comment } : null,
    to: { requester: true, accountManager: true, departments: true },
  });
}
