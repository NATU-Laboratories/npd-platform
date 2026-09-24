import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  brands,
  clients,
  comments,
  departments,
  gateDeciders,
  infoRequests,
  notificationLog,
  projects,
  roles,
  userRoles,
  users,
  type GateKey,
} from "@/db/schema";
import { FIELD_BY_KEY } from "@/lib/brief/fields";
import { CATEGORY_LABEL, PRIORITY_LABEL, statusLabel, TYPE_LABEL } from "@/lib/labels";

import { sendMail } from "@/lib/graph/mail";
import { renderEmail, type ProjectSummary } from "./email-template";
import { enqueueJob, kickJobs } from "./jobs";
import { getSettings } from "./settings";

// ─── Envío y registro ─────────────────────────────────────────────────────

function uniqEmails(list: (string | null | undefined)[]) {
  return [...new Set(list.filter((e): e is string => !!e && e.includes("@")).map((e) => e.trim().toLowerCase()))];
}

/**
 * Registra la notificación en notification_log y la encola. Nunca lanza: un
 * fallo de email no debe perder la acción que lo provocó (§10).
 */
export async function queueNotification(n: {
  event: string;
  projectId?: string | null;
  recipients: (string | null | undefined)[];
  subject: string;
  html: string;
}) {
  const recipients = uniqEmails(n.recipients);
  if (!recipients.length) return null;
  const [row] = await db
    .insert(notificationLog)
    .values({ event: n.event, projectId: n.projectId ?? null, recipients, subject: n.subject, html: n.html })
    .returning({ id: notificationLog.id });
  const jobId = await enqueueJob("email.send", { notificationId: row!.id });
  kickJobs([jobId]);
  return row!.id;
}

/** Ejecutado por la cola. Lanza si falla para que el trabajo se reintente. */
export async function deliverNotification(id: number) {
  const [n] = await db.select().from(notificationLog).where(eq(notificationLog.id, id));
  if (!n || n.status === "sent") return;
  const { sender_mailbox } = await getSettings();
  try {
    await sendMail({ to: n.recipients, subject: n.subject, html: n.html }, sender_mailbox || undefined);
    await db
      .update(notificationLog)
      .set({ status: "sent", sentAt: new Date(), error: null, attempts: sql`${notificationLog.attempts} + 1` })
      .where(eq(notificationLog.id, id));
  } catch (err) {
    await db
      .update(notificationLog)
      .set({ status: "failed", error: err instanceof Error ? err.message : String(err), attempts: sql`${notificationLog.attempts} + 1` })
      .where(eq(notificationLog.id, id));
    throw err;
  }
}

export async function resendNotification(id: number) {
  await db.update(notificationLog).set({ status: "pending", error: null }).where(eq(notificationLog.id, id));
  const jobId = await enqueueJob("email.send", { notificationId: id });
  kickJobs([jobId]);
}

// ─── Datos auxiliares ─────────────────────────────────────────────────────

const requester = alias(users, "requester");
const accountManager = alias(users, "account_manager");

async function loadProject(projectId: string) {
  const [row] = await db
    .select({
      p: projects,
      clientName: clients.name,
      brandName: brands.name,
      requesterName: requester.name,
      requesterEmail: requester.email,
      amEmail: accountManager.email,
    })
    .from(projects)
    .innerJoin(requester, eq(requester.id, projects.requesterId))
    .leftJoin(accountManager, eq(accountManager.id, projects.accountManagerId))
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(brands, eq(brands.id, projects.brandId))
    .where(eq(projects.id, projectId));
  if (!row) throw new Error(`Proyecto ${projectId} no encontrado`);
  const p = row.p;
  const summary: ProjectSummary = {
    id: p.id,
    code: p.code,
    name: p.name,
    typeLabel: p.type ? TYPE_LABEL[p.type] + (p.type === "MP" && row.brandName ? ` · ${row.brandName}` : "") : "—",
    categoryLabel: p.category ? CATEGORY_LABEL[p.category] : "—",
    clientOrBrand: row.clientName ?? row.brandName ?? null,
    requesterName: row.requesterName,
    neededBy: p.neededBy,
    priorityLabel: p.priority ? PRIORITY_LABEL[p.priority] : null,
    statusLabel: statusLabel(p.status, p.phase),
  };
  return { ...row, summary };
}

async function deciderEmails(gate: GateKey, type: "PL" | "MP" | "MDD") {
  const rows = await db
    .select({ email: users.email })
    .from(gateDeciders)
    .innerJoin(users, eq(users.id, gateDeciders.userId))
    .where(and(eq(gateDeciders.gate, gate), eq(gateDeciders.projectType, type), eq(users.status, "active")));
  return rows.map((r) => r.email);
}

async function departmentEmails(where: { ids?: number[]; keys?: string[] }) {
  const cond = where.ids ? inArray(departments.id, where.ids.length ? where.ids : [-1]) : inArray(departments.key, where.keys ?? []);
  const rows = await db.select({ emails: departments.notifyEmails }).from(departments).where(cond);
  return rows.flatMap((r) => r.emails);
}

function subjectFor(s: ProjectSummary, text: string) {
  return `[${s.code ?? "NPD"}] ${text} · ${s.name}`;
}

async function safely(event: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    const { logError } = await import("./errors");
    await logError(`notify:${event}`, err);
  }
}

// ─── Eventos (§6) ─────────────────────────────────────────────────────────

export function notifyPendingUser(userId: string) {
  return safely("user.pending", async () => {
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    const admins = await db
      .select({ email: users.email })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(eq(roles.key, "admin"), eq(users.status, "active")));
    await queueNotification({
      event: "user.pending",
      recipients: admins.map((a) => a.email),
      subject: `Usuario pendiente de activación: ${u?.name}`,
      html: renderEmail({
        title: "Nuevo usuario pendiente de activación",
        intro: `${u?.name} (${u?.email}) ha iniciado sesión por primera vez y necesita que se le asignen roles.`,
        ctaPath: "/admin/usuarios?estado=pending",
        ctaLabel: "Gestionar usuarios",
      }),
    });
  });
}

export function notifySubmitted(projectId: string) {
  return safely("project.submitted", async () => {
    const { p, summary } = await loadProject(projectId);
    const to = [...(await deciderEmails("G1", p.type!)), ...(await departmentEmails({ keys: ["marketing"] }))];
    await queueNotification({
      event: "project.submitted",
      projectId,
      recipients: to,
      subject: subjectFor(summary, "Nueva solicitud"),
      html: renderEmail({
        title: "Nueva solicitud de desarrollo",
        intro: `${summary.requesterName} ha enviado una nueva solicitud pendiente de aprobación (G1).`,
        project: summary,
        extraRows: [["Completitud del brief", `${p.completenessPct}%`]],
        ctaLabel: "Revisar y decidir",
      }),
    });
  });
}

export function notifyInfoRequested(projectId: string, infoRequestId: number) {
  return safely("gate.info_requested", async () => {
    const { summary, requesterEmail, amEmail } = await loadProject(projectId);
    const [ir] = await db.select().from(infoRequests).where(eq(infoRequests.id, infoRequestId));
    const fields = (ir?.fieldsMissing ?? []).map((k) => FIELD_BY_KEY[k]?.label ?? k);
    await queueNotification({
      event: "gate.info_requested",
      projectId,
      recipients: [requesterEmail, amEmail],
      subject: subjectFor(summary, "Se necesita más información"),
      html: renderEmail({
        title: "Se necesita más información",
        intro: "El decisor necesita información adicional para poder evaluar la solicitud.",
        message: { label: "Detalle", body: ir?.message ?? "" },
        extraRows: fields.length ? [["Campos a completar", fields.join(", ")]] : [],
        project: summary,
        ctaLabel: "Responder",
      }),
    });
  });
}

export function notifyInfoAnswered(projectId: string, infoRequestId: number) {
  return safely("info.answered", async () => {
    const { summary } = await loadProject(projectId);
    const [row] = await db
      .select({ answer: infoRequests.answer, email: users.email })
      .from(infoRequests)
      .innerJoin(users, eq(users.id, infoRequests.requestedBy))
      .where(eq(infoRequests.id, infoRequestId));
    await queueNotification({
      event: "info.answered",
      projectId,
      recipients: [row?.email],
      subject: subjectFor(summary, "Información aportada"),
      html: renderEmail({
        title: "El solicitante ha aportado la información",
        intro: "La solicitud vuelve a estar pendiente de decisión.",
        message: row?.answer ? { label: "Respuesta", body: row.answer } : null,
        project: summary,
        ctaLabel: "Revisar y decidir",
      }),
    });
  });
}

export function notifyApproved(projectId: string, departmentIds: number[], comment?: string | null) {
  return safely("gate.approved", async () => {
    const { p, summary, requesterEmail } = await loadProject(projectId);
    const deptNames = departmentIds.length
      ? (await db.select({ name: departments.name }).from(departments).where(inArray(departments.id, departmentIds))).map((d) => d.name)
      : [];
    const b = p.brief;
    const extra: [string, string][] = [["Departamentos implicados", deptNames.join(", ") || "—"]];
    if (b.markets?.length) extra.push(["Mercados", b.markets.join(", ")]);
    if (p.unitsFirstOrder) extra.push(["Unidades primer pedido", p.unitsFirstOrder.toLocaleString("es-ES")]);
    if (b.format) extra.push(["Formato", `${b.format}${b.capacityMl ? ` · ${b.capacityMl} ml` : ""}`]);
    if (b.olfactory?.families?.length) extra.push(["Familias olfativas", b.olfactory.families.join(", ")]);
    await queueNotification({
      event: "gate.approved",
      projectId,
      recipients: [...(await departmentEmails({ ids: departmentIds })), requesterEmail],
      subject: subjectFor(summary, "Proyecto aprobado (G1)"),
      html: renderEmail({
        title: "Solicitud aprobada (G1)",
        intro: "El proyecto pasa a la fase de Cotización. Tu departamento ha sido implicado.",
        message: comment ? { label: "Comentario del decisor", body: comment } : null,
        project: summary,
        extraRows: extra,
      }),
    });
  });
}

/** Aviso genérico de un evento del proyecto a los destinatarios indicados. */
export function notifyProjectEvent(
  projectId: string,
  event: string,
  opts: {
    title: string;
    intro: string;
    message?: { label: string; body: string } | null;
    extraRows?: [string, string][];
    to: { requester?: boolean; accountManager?: boolean; departments?: boolean; deciders?: GateKey };
  },
) {
  return safely(event, async () => {
    const { p, summary, requesterEmail, amEmail } = await loadProject(projectId);
    const recipients: (string | null)[] = [];
    if (opts.to.requester) recipients.push(requesterEmail);
    if (opts.to.accountManager) recipients.push(amEmail);
    if (opts.to.departments) {
      const ids = (await db.execute<{ department_id: number }>(sql`select department_id from project_departments where project_id = ${p.id}`)).rows.map((r) => r.department_id);
      recipients.push(...(await departmentEmails({ ids })));
    }
    if (opts.to.deciders && p.type) recipients.push(...(await deciderEmails(opts.to.deciders, p.type)));
    await queueNotification({
      event,
      projectId,
      recipients,
      subject: subjectFor(summary, opts.title),
      html: renderEmail({ title: opts.title, intro: opts.intro, message: opts.message ?? null, extraRows: opts.extraRows, project: summary }),
    });
  });
}

export function notifyStatusChange(
  projectId: string,
  event: "gate.rejected" | "gate.paused" | "project.resumed" | "project.cancelled",
  reason?: string | null,
) {
  const titles = {
    "gate.rejected": ["Proyecto rechazado", "La solicitud ha sido rechazada."],
    "gate.paused": ["Proyecto en pausa", "El proyecto se ha puesto en pausa."],
    "project.resumed": ["Proyecto reanudado", "El proyecto se ha reanudado."],
    "project.cancelled": ["Proyecto cancelado", "El proyecto ha sido cancelado."],
  } as const;
  return safely(event, async () => {
    const { p, summary, requesterEmail, amEmail } = await loadProject(projectId);
    const [title, intro] = titles[event];
    const deptEmails =
      event === "gate.rejected"
        ? []
        : await departmentEmails({
            ids: (await db.execute<{ department_id: number }>(sql`select department_id from project_departments where project_id = ${p.id}`)).rows.map(
              (r) => r.department_id,
            ),
          });
    await queueNotification({
      event,
      projectId,
      recipients: [requesterEmail, amEmail, ...deptEmails],
      subject: subjectFor(summary, title),
      html: renderEmail({ title, intro, message: reason ? { label: "Motivo", body: reason } : null, project: summary }),
    });
  });
}

export function notifyMentions(commentId: number) {
  return safely("comment.mention", async () => {
    const [c] = await db
      .select({ c: comments, author: users.name })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(eq(comments.id, commentId));
    if (!c) return;
    const { users: userIds, departments: deptIds } = c.c.mentions;
    if (!userIds.length && !deptIds.length) return;
    const { summary } = await loadProject(c.c.projectId);
    const userEmails = userIds.length
      ? (await db.select({ email: users.email }).from(users).where(inArray(users.id, userIds))).map((u) => u.email)
      : [];
    await queueNotification({
      event: "comment.mention",
      projectId: c.c.projectId,
      recipients: [...userEmails, ...(deptIds.length ? await departmentEmails({ ids: deptIds }) : [])],
      subject: subjectFor(summary, `${c.author} te ha mencionado`),
      html: renderEmail({
        title: `${c.author} te ha mencionado`,
        intro: "Tienes una mención en un comentario del proyecto.",
        message: { label: "Comentario", body: c.c.body },
        project: summary,
        ctaPath: `/proyectos/${c.c.projectId}#comentarios`,
        ctaLabel: "Ver comentario",
      }),
    });
  });
}

