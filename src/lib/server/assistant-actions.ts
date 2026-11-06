import "server-only";
import { and, desc, eq, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { assistantActions, comments, departmentMembers, departments, projects, replenishments, suppliers, userNotices, users } from "@/db/schema";
import { sendProactive } from "@/lib/teams/connector";
import { logActivity } from "./activity";
import { canViewProject, isActive, loadUser, type CurrentUser } from "./authz";
import { renderEmail } from "./email-template";
import { logError } from "./errors";
import { queueNotification, uniqEmails } from "./notifications";
import { listProjects } from "./dashboard";
import { addComment, canAccessReplenishments, canActAs, departmentRecipients, listReplenishments, sendQuoteRequests } from "./replenishments";

/**
 * Acciones que Alexia puede hacer por una persona. Nunca se ejecutan al momento:
 * Alexia las prepara, la persona las ve y las confirma, y entonces se ejecutan con
 * sus permisos (se vuelven a comprobar al confirmar). Todo queda registrado «vía Alexia».
 */

export type ActionChannel = { channel: "web" | "teams"; conversationId?: string | null };
export type PreparedAction = { id: string; title: string; lines: [string, string][]; status?: "pending" | "done" | "failed"; result?: string };

const PENDING_MINUTES = 30;

// ─── Sujeto (proyecto NPD o reposición) ───────────────────────────────────

type Subject = { kind: "project" | "replenishment"; id: string; code: string; name: string; link: string };

async function resolveSubject(u: CurrentUser, code?: string | null): Promise<Subject | null | "forbidden" | "missing" | { ambiguous: string[] }> {
  const key = code?.trim();
  if (!key) return null;
  if (/^REP-\d{4}-\d+$/i.test(key)) {
    if (!canAccessReplenishments(u)) return "forbidden";
    const [r] = await db.select({ id: replenishments.id, code: replenishments.code, title: replenishments.title }).from(replenishments).where(eq(replenishments.code, key.toUpperCase()));
    return r ? { kind: "replenishment", id: r.id, code: r.code, name: r.title, link: `/reposiciones/${r.id}` } : "missing";
  }
  const [p] = await db.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects).where(eq(projects.code, key.toUpperCase()));
  if (p) {
    if (!(await canViewProject(u, p.id))) return "forbidden";
    return { kind: "project", id: p.id, code: p.code ?? key, name: p.name, link: `/proyectos/${p.id}` };
  }
  // No es un código exacto: búsqueda por nombre (sin tildes, espacios ni orden de palabras), solo entre lo visible
  const { rows } = await listProjects(u, { q: key }, 30);
  const reps = canAccessReplenishments(u) ? await listReplenishments(u, { q: key }) : [];
  const found: Subject[] = [
    ...rows.filter((r) => r.code).map((r) => ({ kind: "project" as const, id: r.id, code: r.code!, name: r.name, link: `/proyectos/${r.id}` })),
    ...reps.map((r) => ({ kind: "replenishment" as const, id: r.id, code: r.code, name: r.title, link: `/reposiciones/${r.id}` })),
  ];
  if (found.length === 1) return found[0]!;
  if (!found.length) return "missing";
  return { ambiguous: found.slice(0, 6).map((f) => `${f.code} · ${f.name}`) };
}

const isSubject = (x: unknown): x is Subject => typeof x === "object" && x !== null && "kind" in x;

/** Mensaje para la IA cuando el proyecto no se puede determinar. */
function subjectProblem(r: "forbidden" | "missing" | { ambiguous: string[] }, asked: string) {
  if (r === "forbidden") return `No tienes acceso a «${asked}».`;
  if (r === "missing") return `No encuentro ningún proyecto ni reposición visible que coincida con «${asked}». Busca con buscar_proyectos (también admite nombres aproximados) o pregunta a la persona.`;
  return `«${asked}» coincide con varios: ${r.ambiguous.join("; ")}. Pregunta a la persona a cuál se refiere.`;
}

// ─── Destinatarios (departamento o persona) ───────────────────────────────

type Target = { label: string; deptKeys: string[]; userIds: string[] };

async function resolveTarget(text: string): Promise<Target | string> {
  const q = text.trim();
  if (!q) return "Indica a quién va el aviso (un departamento o una persona).";
  const term = `%${q}%`;
  const depts = await db
    .select({ key: departments.key, name: departments.name })
    .from(departments)
    .where(and(eq(departments.isActive, true), or(ilike(departments.name, term), ilike(departments.key, term))));
  const exactDept = depts.filter((d) => d.name.toLowerCase() === q.toLowerCase() || d.key === q.toLowerCase());
  const deptPick = exactDept.length ? exactDept : depts;
  if (deptPick.length === 1 && deptPick[0]!.key) return { label: deptPick[0]!.name, deptKeys: [deptPick[0]!.key], userIds: [] };
  const people = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.status, "active"), or(ilike(users.name, term), ilike(users.email, term))))
    .limit(10);
  const exactPerson = people.filter((p) => p.name.toLowerCase() === q.toLowerCase());
  const personPick = exactPerson.length ? exactPerson : people;
  if (!deptPick.length && personPick.length === 1) return { label: personPick[0]!.name, deptKeys: [], userIds: [personPick[0]!.id] };
  const options = [...deptPick.map((d) => d.name), ...personPick.map((p) => p.name)];
  if (!options.length) return `No encuentro ningún departamento ni persona que coincida con «${q}».`;
  return `«${q}» coincide con varios destinatarios: ${options.join(", ")}. Pregunta a cuál se refiere.`;
}

/** Usuarios activos de los departamentos (los que reciben el aviso en el chat). */
async function deptUserIds(keys: string[]) {
  if (!keys.length) return [];
  const rows = await db
    .select({ id: users.id })
    .from(departmentMembers)
    .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
    .innerJoin(users, eq(users.id, departmentMembers.userId))
    .where(and(inArray(departments.key, keys), eq(users.status, "active")));
  return [...new Set(rows.map((r) => r.id))];
}

// ─── Preparar (lo llaman las herramientas de Alexia) ─────────────────────────

async function store(u: CurrentUser, ch: ActionChannel, kind: string, payload: Record<string, unknown>, summary: { title: string; lines: [string, string][] }): Promise<PreparedAction | string> {
  if (u.viewAs) return "Estás en vista previa como otra persona: no se pueden preparar acciones.";
  const [row] = await db
    .insert(assistantActions)
    .values({ userId: u.id, kind, payload, summary, channel: ch.channel, conversationId: ch.conversationId ?? null })
    .returning({ id: assistantActions.id });
  return { id: row!.id, ...summary };
}

export const notifyInput = z.object({
  destinatario: z.string().min(1).max(100).describe("Departamento (p. ej. «Diseño») o persona a la que va el aviso"),
  mensaje: z.string().min(1).max(2000).describe("Texto del aviso, redactado en primera persona por el usuario"),
  sobre: z.string().max(120).optional().describe("Código (2026-PL-0007, REP-2026-0001) o nombre, aunque sea aproximado, del proyecto o reposición al que se refiere, si lo hay"),
  urgente: z.boolean().optional().describe("Marcar como urgente"),
});

export async function prepareNotify(u: CurrentUser, ch: ActionChannel, i: z.infer<typeof notifyInput>): Promise<PreparedAction | string> {
  const target = await resolveTarget(i.destinatario);
  if (typeof target === "string") return target;
  const subject = await resolveSubject(u, i.sobre);
  if (subject && !isSubject(subject)) return subjectProblem(subject, i.sobre!);
  return store(u, ch, "notify", { target, subject, message: i.mensaje.trim(), urgent: !!i.urgente }, {
    title: `Aviso${i.urgente ? " urgente" : ""} para ${target.label}`,
    lines: [
      ["Para", target.label],
      ...(subject ? ([["Sobre", `${subject.code} · ${subject.name}`]] as [string, string][]) : []),
      ["Mensaje", i.mensaje.trim()],
      ["Cómo llega", `Email y aviso de Alexia en su chat${subject ? "; queda también como comentario en la ficha" : ""}`],
    ],
  });
}

export const commentInput = z.object({
  sobre: z.string().min(1).max(120).describe("Código (2026-PL-0007, REP-2026-0001) o nombre aproximado del proyecto o reposición"),
  comentario: z.string().min(1).max(4000).describe("Texto del comentario, tal como lo quiere el usuario"),
});

export async function prepareComment(u: CurrentUser, ch: ActionChannel, i: z.infer<typeof commentInput>): Promise<PreparedAction | string> {
  const subject = await resolveSubject(u, i.sobre);
  if (!subject) return "Indica en qué proyecto o reposición quieres comentar.";
  if (!isSubject(subject)) return subjectProblem(subject, i.sobre);
  return store(u, ch, "comment", { subject, body: i.comentario.trim() }, {
    title: `Comentario en ${subject.code}`,
    lines: [
      ["En", `${subject.code} · ${subject.name}`],
      ["Comentario", i.comentario.trim()],
    ],
  });
}

export const quoteInput = z.object({
  reposicion: z.string().min(1).max(40).describe("Código de la reposición (REP-2026-0001)"),
  proveedor: z.string().max(100).optional().describe("Proveedor concreto; si se omite, a todos los de la reposición"),
  mensaje: z.string().max(2000).optional().describe("Mensaje para el proveedor"),
});

export async function prepareQuote(u: CurrentUser, ch: ActionChannel, i: z.infer<typeof quoteInput>): Promise<PreparedAction | string> {
  const subject = await resolveSubject(u, i.reposicion);
  if (!subject) return "Indica la reposición.";
  if (!isSubject(subject)) return subjectProblem(subject, i.reposicion);
  if (subject.kind !== "replenishment") return `${subject.code} no es una reposición.`;
  const [rep] = await db.select({ requesterId: replenishments.requesterId }).from(replenishments).where(eq(replenishments.id, subject.id));
  if (!rep || !canActAs(u, rep, "compras")) return "Solo Compras (o quien abrió la reposición) puede pedir recotizaciones.";
  let supplier: { id: number; name: string } | null = null;
  if (i.proveedor?.trim()) {
    const found = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(ilike(suppliers.name, `%${i.proveedor.trim()}%`)).limit(5);
    if (found.length !== 1) return found.length ? `Hay varios proveedores que coinciden: ${found.map((s) => s.name).join(", ")}.` : `No encuentro el proveedor «${i.proveedor}».`;
    supplier = found[0]!;
  }
  const message = i.mensaje?.trim() || "Necesitamos reponer los materiales indicados. Por favor, enviadnos la cotización actualizada y el plazo de entrega.\n\nGracias.";
  return store(u, ch, "request_quote", { subject, supplierId: supplier?.id ?? null, message }, {
    title: `Pedir recotización${supplier ? ` a ${supplier.name}` : " a los proveedores"}`,
    lines: [
      ["Reposición", `${subject.code} · ${subject.name}`],
      ["Proveedor", supplier?.name ?? "Todos los de la reposición"],
      ["Mensaje", message],
    ],
  });
}

// ─── Confirmar / cancelar ─────────────────────────────────────────────────

type Row = typeof assistantActions.$inferSelect;

async function loadPending(userId: string, id: string) {
  const [a] = await db.select().from(assistantActions).where(and(eq(assistantActions.id, id), eq(assistantActions.userId, userId)));
  return a ?? null;
}

/** Última acción pendiente de una conversación de Teams (para confirmar con «sí»/«no»). */
export async function latestPendingTeams(userId: string, conversationId: string) {
  const [a] = await db
    .select()
    .from(assistantActions)
    .where(
      and(
        eq(assistantActions.userId, userId),
        eq(assistantActions.channel, "teams"),
        eq(assistantActions.conversationId, conversationId),
        eq(assistantActions.status, "pending"),
        gt(assistantActions.createdAt, new Date(Date.now() - PENDING_MINUTES * 60_000)),
      ),
    )
    .orderBy(desc(assistantActions.createdAt))
    .limit(1);
  return a ?? null;
}

export async function cancelAction(u: CurrentUser, id: string) {
  const a = await loadPending(u.id, id);
  if (!a || a.status !== "pending") return { ok: false as const, message: "Esa acción ya no está pendiente." };
  await db.update(assistantActions).set({ status: "cancelled", executedAt: new Date() }).where(eq(assistantActions.id, id));
  return { ok: true as const, message: "Cancelado: no he hecho nada." };
}

/** Ejecuta una acción confirmada por la persona (permisos comprobados de nuevo). */
export async function confirmAction(u: CurrentUser, id: string): Promise<{ ok: boolean; message: string }> {
  const a = await loadPending(u.id, id);
  if (!a || a.status !== "pending") return { ok: false, message: "Esa acción ya no está pendiente." };
  if (a.createdAt.getTime() < Date.now() - PENDING_MINUTES * 60_000) {
    await db.update(assistantActions).set({ status: "cancelled", result: "caducada" }).where(eq(assistantActions.id, id));
    return { ok: false, message: "Ha pasado demasiado tiempo: pídemelo otra vez y la preparo de nuevo." };
  }
  // Bloqueo optimista: solo una confirmación gana
  const [claimed] = await db
    .update(assistantActions)
    .set({ status: "running" })
    .where(and(eq(assistantActions.id, id), eq(assistantActions.status, "pending")))
    .returning({ id: assistantActions.id });
  if (!claimed) return { ok: false, message: "Esa acción ya se está ejecutando." };
  try {
    const message = await execute(u, a);
    await db.update(assistantActions).set({ status: "done", result: message, executedAt: new Date() }).where(eq(assistantActions.id, id));
    return { ok: true, message };
  } catch (err) {
    const msg = err instanceof Error && err.message.length < 200 ? err.message : "No se ha podido completar.";
    await db.update(assistantActions).set({ status: "failed", result: msg, executedAt: new Date() }).where(eq(assistantActions.id, id));
    await logError("nia:action", err, { id, kind: a.kind });
    return { ok: false, message: msg };
  }
}

async function recheckSubject(u: CurrentUser, s: Subject | null) {
  if (!s) return;
  const ok = s.kind === "project" ? await canViewProject(u, s.id) : canAccessReplenishments(u);
  if (!ok) throw new Error(`Ya no tienes acceso a ${s.code}.`);
}

async function commentOn(u: CurrentUser, s: Subject, body: string) {
  if (s.kind === "replenishment") return addComment(u, s.id, body);
  const [c] = await db.insert(comments).values({ projectId: s.id, authorId: u.id, body, mentions: { users: [], departments: [] } }).returning({ id: comments.id });
  await logActivity({ projectId: s.id, actorId: u.id, action: "comment.created", entity: "comment", entityId: c!.id, diff: { body: body.slice(0, 500), via: "Alexia" } });
}

async function execute(u: CurrentUser, a: Row): Promise<string> {
  const p = a.payload as Record<string, unknown>;
  const subject = (p.subject as Subject | null) ?? null;
  await recheckSubject(u, subject);

  if (a.kind === "comment") {
    await commentOn(u, subject!, String(p.body));
    return `Listo, comentario publicado en ${subject!.code}.`;
  }

  if (a.kind === "request_quote") {
    const res = await sendQuoteRequests(u, subject!.id, (p.supplierId as number | null) ?? null, String(p.message));
    if (!res.sent.length) throw new Error(res.withoutEmail.length ? `Ningún proveedor tiene email (${res.withoutEmail.join(", ")}). Añádelo en Backoffice → Proveedores.` : "No hay proveedores a los que enviar.");
    return `Hecho: recotización pedida a ${res.sent.join(", ")}${res.withoutEmail.length ? ` (sin email: ${res.withoutEmail.join(", ")})` : ""}.`;
  }

  if (a.kind === "notify") {
    const target = p.target as Target;
    const message = String(p.message);
    const urgent = !!p.urgent;
    const everyone = [...new Set([...target.userIds, ...(await deptUserIds(target.deptKeys))])];
    // A quien envía no le llega copia, salvo que el aviso sea solo para sí mismo (p. ej. para probar)
    const toSelfOnly = everyone.length > 0 && everyone.every((id) => id === u.id);
    const recipients = toSelfOnly ? everyone : everyone.filter((id) => id !== u.id);
    const title = `${urgent ? "Urgente · " : ""}Aviso de ${u.name}${subject ? ` sobre ${subject.code}` : ""}`;
    // 1) Aviso en el chat de Alexia (web y Teams)
    if (recipients.length) {
      const rows = await db
        .insert(userNotices)
        .values(recipients.map((userId) => ({ userId, fromUserId: u.id, title, body: message, link: subject?.link ?? null, urgent })))
        .returning({ id: userNotices.id, userId: userNotices.userId });
      const teamsText = noticeText({ from: u.name, body: message, urgent, subject });
      for (const r of rows) {
        // Si le llega por Teams, ya lo ha visto: no se le repite en la web
        const sent = await sendProactive(r.userId, teamsText).catch((err) => (logError("nia:proactive", err, { userId: r.userId }), false));
        if (sent) await db.update(userNotices).set({ readAt: new Date() }).where(eq(userNotices.id, r.id));
      }
    }
    // 2) Email
    const emails = uniqEmails([
      ...(await departmentRecipients(target.deptKeys)),
      ...(target.userIds.length ? (await db.select({ email: users.email }).from(users).where(inArray(users.id, target.userIds))).map((x) => x.email) : []),
    ]).filter((e) => toSelfOnly || e !== u.email.toLowerCase());
    if (emails.length)
      await queueNotification({
        event: "nia.notice",
        projectId: subject?.kind === "project" ? subject.id : null,
        replenishmentId: subject?.kind === "replenishment" ? subject.id : null,
        recipients: emails,
        replyTo: [u.email],
        subject: `${urgent ? "[URGENTE] " : ""}${subject ? `[${subject.code}] ` : ""}Aviso de ${u.name}`,
        html: renderEmail({
          title: urgent ? "Aviso urgente" : "Tienes un aviso",
          intro: `${u.name} te envía este aviso${subject ? ` sobre ${subject.code} · ${subject.name}` : ""}.`,
          message: { label: `Mensaje de ${u.name}`, body: message },
          ctaPath: subject?.link ?? "/",
          ctaLabel: subject ? "Abrir en la plataforma" : "Ir a la plataforma",
        }),
      });
    // 3) Rastro en la ficha
    if (subject) await commentOn(u, subject, `📣 Aviso${urgent ? " urgente" : ""} para ${target.label}: ${message}`);
    await logActivity({ projectId: subject?.kind === "project" ? subject.id : null, actorId: u.id, action: "nia.notice", entity: "notice", entityId: a.id, diff: { to: target.label, urgent, via: "Alexia" } });
    if (!recipients.length && !emails.length) throw new Error(`${target.label} no tiene a nadie a quien avisar (sin miembros ni emails de aviso).`);
    return `Enviado ✅ ${target.label} ya tiene el aviso${recipients.length ? " en su chat" : ""}${emails.length ? " y por email" : ""}.`;
  }
  throw new Error("Acción desconocida");
}

// ─── Avisos recibidos ─────────────────────────────────────────────────────

/** Texto del aviso tal como lo cuenta Alexia en el chat. */
export function noticeText(n: { from: string | null; body: string; urgent: boolean; subject?: { code: string; name: string; link: string } | null; link?: string | null }) {
  const about = n.subject ? ` sobre [${n.subject.code} · ${n.subject.name}](${n.subject.link})` : n.link ? ` ([ver](${n.link}))` : "";
  return `📬 ${n.urgent ? "**Aviso urgente**" : "**Aviso**"} de **${n.from ?? "alguien del equipo"}**${about}:\n\n«${n.body}»`;
}

export async function unreadNotices(userId: string) {
  return db
    .select({ id: userNotices.id, title: userNotices.title, body: userNotices.body, link: userNotices.link, urgent: userNotices.urgent, createdAt: userNotices.createdAt, from: users.name })
    .from(userNotices)
    .leftJoin(users, eq(users.id, userNotices.fromUserId))
    .where(and(eq(userNotices.userId, userId), isNull(userNotices.readAt)))
    .orderBy(desc(userNotices.createdAt))
    .limit(20);
}

export async function recentNotices(userId: string) {
  return db
    .select({ id: userNotices.id, title: userNotices.title, body: userNotices.body, link: userNotices.link, urgent: userNotices.urgent, createdAt: userNotices.createdAt, readAt: userNotices.readAt, from: users.name })
    .from(userNotices)
    .leftJoin(users, eq(users.id, userNotices.fromUserId))
    .where(eq(userNotices.userId, userId))
    .orderBy(desc(userNotices.createdAt))
    .limit(15);
}

export async function markNoticesRead(userId: string, ids?: number[]) {
  await db
    .update(userNotices)
    .set({ readAt: new Date() })
    .where(and(eq(userNotices.userId, userId), isNull(userNotices.readAt), ids?.length ? inArray(userNotices.id, ids) : sql`true`));
}

/** Para comprobaciones desde rutas: usuario activo por id. */
export async function activeUser(id: string) {
  const u = await loadUser(id);
  return u && isActive(u) ? u : null;
}
