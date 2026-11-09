import "server-only";
import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { departmentMembers, departments, proactiveAlerts, projects, replenishmentItems, replenishments, roles, suppliers, userNotices, userRoles, users } from "@/db/schema";
import { ELEMENT_LABEL } from "@/lib/replenishment/config";
import { sendProactive } from "@/lib/teams/connector";
import { formatDate } from "@/lib/utils";
import { renderEmail } from "./email-template";
import { logError } from "./errors";
import { queueNotification, uniqEmails } from "./notifications";
import { getSettings } from "./settings";

/**
 * Alexia proactiva: revisión diaria (cron) que avisa sin que nadie pregunte.
 * - Proyectos a punto de entrar en riesgo (y el día que entran) → gestores de proyectos.
 * - Recotizaciones sin respuesta del proveedor → Compras y gestores de proyectos.
 * Cada aviso se registra en `proactive_alerts` para no repetirlo.
 */

/** Proyectos abiertos y en marcha (los pausados no avisan). */
const WATCHED_STATUSES = ["submitted", "info_requested", "in_progress"] as const;
/** Recordatorios por la misma petición de presupuesto. */
const MAX_QUOTE_REMINDERS = 3;

type Recipients = { userIds: string[]; emails: string[] };

async function withRole(key: "admin" | "global_decider"): Promise<Recipients> {
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(roles.key, key), eq(users.status, "active")));
  return { userIds: rows.map((r) => r.id), emails: uniqEmails(rows.map((r) => r.email)) };
}

/** Gestores de proyectos activos; si no hay ninguno con email, los administradores (para que el aviso no se pierda). */
async function projectManagers(): Promise<Recipients> {
  const managers = await withRole("global_decider");
  return managers.emails.length ? managers : merge(managers, await withRole("admin"));
}

const hasAnyone = (r: Recipients) => r.userIds.length > 0 || r.emails.length > 0;

/** Miembros activos de un departamento; el email va a su buzón de aviso si lo tiene. */
async function department(key: string): Promise<Recipients> {
  const [d] = await db.select({ id: departments.id, emails: departments.notifyEmails }).from(departments).where(eq(departments.key, key));
  if (!d) return { userIds: [], emails: [] };
  const members = await db
    .select({ id: users.id, email: users.email })
    .from(departmentMembers)
    .innerJoin(users, eq(users.id, departmentMembers.userId))
    .where(and(eq(departmentMembers.departmentId, d.id), eq(users.status, "active")));
  return { userIds: members.map((m) => m.id), emails: d.emails.length ? d.emails : members.map((m) => m.email) };
}

const merge = (...rs: Recipients[]): Recipients => ({ userIds: [...new Set(rs.flatMap((r) => r.userIds))], emails: uniqEmails(rs.flatMap((r) => r.emails)) });

/** Reserva el aviso; false si ya se había enviado. */
async function claim(kind: string, entityId: string, stage: string) {
  const rows = await db.insert(proactiveAlerts).values({ kind, entityId, stage }).onConflictDoNothing().returning({ kind: proactiveAlerts.kind });
  return rows.length > 0;
}

/** Aviso de Alexia por su chat, Teams (si la persona ya habló con el bot) y email. */
async function alert(
  to: Recipients,
  a: { event: string; title: string; body: string; link: string; urgent?: boolean; rows?: [string, string][]; projectId?: string | null; replenishmentId?: string | null },
) {
  if (to.userIds.length) {
    const inserted = await db
      .insert(userNotices)
      .values(to.userIds.map((userId) => ({ userId, fromUserId: null, title: a.title, body: a.body, link: a.link, urgent: !!a.urgent })))
      .returning({ id: userNotices.id, userId: userNotices.userId });
    const text = `🔔 **${a.title}**\n\n${a.body}\n\n[Abrir en la plataforma](${a.link})`;
    for (const r of inserted) {
      const sent = await sendProactive(r.userId, text).catch((err) => (logError("alexia:proactive", err, { userId: r.userId }), false));
      if (sent) await db.update(userNotices).set({ readAt: new Date() }).where(eq(userNotices.id, r.id));
    }
  }
  if (to.emails.length)
    await queueNotification({
      event: a.event,
      projectId: a.projectId ?? null,
      replenishmentId: a.replenishmentId ?? null,
      recipients: to.emails,
      subject: `${a.urgent ? "[URGENTE] " : ""}${a.title}`,
      html: renderEmail({ title: a.title, intro: `Aviso automático de Alexia. ${a.body}`, extraRows: a.rows, ctaPath: a.link, ctaLabel: "Abrir en la plataforma" }),
    });
}

const daysUntil = (date: string) => Math.round((new Date(`${date}T12:00:00Z`).getTime() - new Date(`${new Date().toISOString().slice(0, 10)}T12:00:00Z`).getTime()) / 86_400_000);

/** Proyectos que entrarán en riesgo en `risk_warning_days` días (o entran hoy). */
async function checkProjectRisk(riskDays: number, warningDays: number) {
  const rows = await db
    .select({ id: projects.id, code: projects.code, name: projects.name, neededBy: projects.neededBy, phase: projects.phase })
    .from(projects)
    .where(
      and(
        inArray(projects.status, [...WATCHED_STATUSES]),
        isNotNull(projects.neededBy),
        lte(projects.neededBy, sql`(current_date + ${riskDays + warningDays}::int)`),
      ),
    );
  if (!rows.length) return 0;
  const managers = await projectManagers();
  if (!hasAnyone(managers)) return 0; // sin destinatarios no se marca como avisado
  let sent = 0;
  for (const p of rows) {
    const left = daysUntil(p.neededBy!);
    const inRisk = left <= riskDays;
    // La fecha forma parte del aviso: si cambia la entrega requerida, se vuelve a avisar
    const stage = `${inRisk ? "risk" : "pre_risk"}:${p.neededBy}`;
    if (!(await claim("project_risk", p.id, stage))) continue;
    const label = `${p.code ?? "Proyecto"} · ${p.name}`;
    const when = left < 0 ? `venció hace ${-left} día${left === -1 ? "" : "s"}` : left === 0 ? "es hoy" : `es dentro de ${left} día${left === 1 ? "" : "s"} (${formatDate(p.neededBy!)})`;
    await alert(managers, {
      event: inRisk ? "alexia.project_risk" : "alexia.project_pre_risk",
      projectId: p.id,
      urgent: inRisk,
      link: `/proyectos/${p.id}`,
      title: inRisk ? `${label} ha entrado en riesgo` : `${label} entrará en riesgo en ${left - riskDays} día${left - riskDays === 1 ? "" : "s"}`,
      body: inRisk
        ? `La entrega requerida ${when}. Revisa qué departamentos van con retraso y si hay que replanificar o hablar con el cliente.`
        : `La entrega requerida ${when}: a partir de ${riskDays} días antes se considera en riesgo. Es buen momento para revisar el avance de los departamentos.`,
      rows: [
        ["Proyecto", label],
        ["Entrega requerida", formatDate(p.neededBy!)],
      ],
    });
    sent++;
  }
  return sent;
}

/** Recotizaciones pedidas hace `quote_followup_days` días (o múltiplos) sin respuesta del proveedor. */
async function checkSupplierQuotes(followupDays: number) {
  const rows = await db
    .select({
      itemId: replenishmentItems.id,
      element: replenishmentItems.element,
      description: replenishmentItems.description,
      requestedAt: replenishmentItems.quoteRequestedAt,
      supplierId: suppliers.id,
      supplier: suppliers.name,
      repId: replenishments.id,
      code: replenishments.code,
      title: replenishments.title,
    })
    .from(replenishmentItems)
    .innerJoin(replenishments, eq(replenishments.id, replenishmentItems.replenishmentId))
    .innerJoin(suppliers, eq(suppliers.id, replenishmentItems.supplierId))
    .where(
      and(
        eq(replenishmentItems.quoteStatus, "requested"),
        isNotNull(replenishmentItems.quoteRequestedAt),
        lte(replenishmentItems.quoteRequestedAt, sql`now() - make_interval(days => ${followupDays})`),
        sql`${replenishments.status} not in ('closed', 'cancelled')`,
      ),
    );
  if (!rows.length) return 0;
  // Un aviso por reposición y proveedor (con todos sus elementos pendientes)
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(`${r.repId}:${r.supplierId}`, [...(groups.get(`${r.repId}:${r.supplierId}`) ?? []), r]);
  const to = merge(await department("compras"), await projectManagers());
  if (!hasAnyone(to)) return 0;
  let sent = 0;
  for (const [key, items] of groups) {
    const first = items[0]!;
    const oldest = Math.min(...items.map((i) => i.requestedAt!.getTime()));
    const days = Math.floor((Date.now() - oldest) / 86_400_000);
    const round = Math.min(MAX_QUOTE_REMINDERS, Math.floor(days / followupDays));
    if (round < 1) continue;
    // La fecha de la petición forma parte del aviso: si se vuelve a pedir, se reinicia
    if (!(await claim("supplier_quote", key, `${new Date(oldest).toISOString().slice(0, 10)}:${round}`))) continue;
    const list = items.map((i) => `${ELEMENT_LABEL[i.element] ?? i.element}${i.description ? ` (${i.description})` : ""}`).join(", ");
    await alert(to, {
      event: "alexia.supplier_no_reply",
      replenishmentId: first.repId,
      urgent: round >= 2,
      link: `/reposiciones/${first.repId}`,
      title: `${first.supplier} no ha respondido a la recotización de ${first.code}`,
      body: `Se le pidió presupuesto hace ${days} días (${list}) y todavía no hay respuesta registrada. Conviene llamarle o volver a pedírsela; cuando llegue, regístrala en la reposición.${round >= MAX_QUOTE_REMINDERS ? " Es el último recordatorio." : ""}`,
      rows: [
        ["Reposición", `${first.code} · ${first.title}`],
        ["Proveedor", first.supplier],
        ["Elementos", list],
        ["Pedida el", formatDate(new Date(oldest))],
      ],
    });
    sent++;
  }
  return sent;
}

/** Revisión diaria (la lanza el cron). Un fallo en una comprobación no impide las demás. */
export async function runWatchdog() {
  const s = await getSettings();
  const out: Record<string, number | string> = {};
  try {
    out.projectRisk = await checkProjectRisk(s.risk_days, s.risk_warning_days);
  } catch (err) {
    await logError("alexia:watchdog:risk", err);
    out.projectRisk = "error";
  }
  try {
    out.supplierQuotes = await checkSupplierQuotes(s.quote_followup_days);
  } catch (err) {
    await logError("alexia:watchdog:quotes", err);
    out.supplierQuotes = "error";
  }
  return out;
}
