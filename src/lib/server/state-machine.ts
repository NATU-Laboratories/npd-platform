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
  type Project,
  type ProjectStatus,
} from "@/db/schema";
import { computeCompleteness, FIELD_BY_KEY, submitErrors } from "@/lib/brief/fields";
import { parseBriefLenient, type BriefData } from "@/lib/brief/schema";
import { logActivity, jsonDiff } from "./activity";
import { canDecideGate, canEditBrief, canManageProject, canRequest, type CurrentUser } from "./authz";
import { enqueueJob, kickJobs } from "./jobs";
import {
  notifyApproved,
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
  | "cancel";

const ALLOWED: Record<Transition, ProjectStatus[]> = {
  submit: ["draft"],
  approve: ["submitted", "info_requested"],
  request_info: ["submitted", "info_requested"],
  answer_info: ["info_requested"],
  reject: ["submitted", "info_requested"],
  pause: ["submitted", "info_requested", "in_progress"],
  resume: ["paused"],
  cancel: ["in_progress", "paused"],
};

export function canTransition(status: ProjectStatus, t: Transition) {
  return ALLOWED[t].includes(status);
}

function assertTransition(p: Project, t: Transition) {
  if (!canTransition(p.status, t)) throw new ActionError(`Acción no permitida en el estado actual del proyecto`);
}

async function loadForUpdate(tx: Tx, projectId: string) {
  const [p] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
  if (!p) throw new ActionError("Proyecto no encontrado");
  return p;
}

function currentGate(p: Pick<Project, "phase">): GateKey {
  return (["G1", "G2", "G3", "G4", "G5"] as const)[p.phase] ?? "G1";
}

/** Columnas desnormalizadas a partir del brief (filtros y KPIs, §9.3). */
function columnsFromBrief(b: BriefData) {
  const isPL = b.type === "PL";
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

async function nextCode(tx: Tx, type: "PL" | "MP") {
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

    if (brief.type === "PL" && brief.newClient && !brief.clientId) {
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
    if (gate !== "G1") throw new ActionError("En esta versión solo se decide la puerta G1");
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
          .set({ status: "in_progress", phase: 1, decidedG1At: now, templateId: decision.templateId ?? null, updatedAt: now })
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
    const gate = currentGate(p);
    await tx.update(gates).set({ status: "pending" }).where(and(eq(gates.projectId, projectId), eq(gates.gate, gate)));
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
    await tx
      .update(gates)
      .set({ status: "pending" })
      .where(and(eq(gates.projectId, projectId), eq(gates.gate, currentGate(p)), eq(gates.status, "paused")));
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
