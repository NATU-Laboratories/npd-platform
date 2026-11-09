import "server-only";
import { and, desc, eq, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { assistantActions, comments, departmentMembers, departments, deptNotes, projects, replenishmentItems, replenishments, suppliers, userNotices, users } from "@/db/schema";
import { ELEMENT_LABEL } from "@/lib/replenishment/config";
import { findSheetField, parseFieldValue } from "@/lib/sheet/field-input";
import { applicable, formatValue, SHEET_SECTIONS, type ScalarField } from "@/lib/sheet/sections";
import { sendProactive } from "@/lib/teams/connector";
import { logActivity } from "./activity";
import { canViewProject, isActive, loadUser, type CurrentUser } from "./authz";
import { renderEmail } from "./email-template";
import { logError } from "./errors";
import { queueNotification, uniqEmails } from "./notifications";
import { listProjects } from "./dashboard";
import { addComment, canAccessReplenishments, canActAs, departmentRecipients, listReplenishments, registerQuote, repLabNote, sendQuoteRequests } from "./replenishments";
import { normalizeText, searchTokens } from "./fuzzy";
import { refTitle } from "./references";
import { canEditSection, deptStartPhases, loadProjectRow, sectionDeptKeys, sheetContext, sheetRefsFor, setSheetField } from "./sheet";

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

// ─── Anotar en la ficha del proyecto ──────────────────────────────────────

export const sheetFieldInput = z.object({
  sobre: z.string().min(1).max(120).describe("Código o nombre aproximado del proyecto NPD"),
  campo: z.string().min(1).max(120).describe("Campo de la ficha tal como lo diga la persona (p. ej. «proveedor del tapón», «precio unitario final», «UFI», «troquel»)"),
  apartado: z.string().max(80).optional().describe("Apartado de la ficha si se sabe (p. ej. «Envase y packaging», «Calidad y regulatorio»)"),
  valor: z.string().min(1).max(4000).describe("Valor que hay que anotar, tal como lo dice la persona"),
  referencia: z.string().max(60).optional().describe("Referencia del proyecto (A, B… o su nombre) si el proyecto tiene varias"),
});

export async function prepareSheetField(u: CurrentUser, ch: ActionChannel, i: z.infer<typeof sheetFieldInput>): Promise<PreparedAction | string> {
  const subject = await resolveSubject(u, i.sobre);
  if (!subject) return "Indica en qué proyecto hay que anotarlo.";
  if (!isSubject(subject)) return subjectProblem(subject, i.sobre);
  if (subject.kind !== "project") return "Las reposiciones no tienen ficha: para dejar constancia usa un comentario (o registra el presupuesto del proveedor).";
  const p = await loadProjectRow(subject.id);
  if (!p) return "No encuentro el proyecto.";
  const ctx = await sheetContext(p);
  const found = findSheetField(i.campo, i.apartado).filter((c) => applicable([c.field], ctx).length);
  if (!found.length) return `No encuentro en la ficha un campo «${i.campo}». Pregunta a la persona a qué campo se refiere (o anótalo como comentario).`;
  if (found.length > 1)
    return `«${i.campo}» puede ser varios campos: ${found
      .slice(0, 8)
      .map((c) => `«${c.field.label}${c.group ? ` · ${c.group}` : ""}» (${c.section.title})`)
      .join(", ")}. Pregunta cuál.`;
  const { section, field, group } = found[0]!;
  const parsed = parseFieldValue(field, i.valor);
  if (!parsed.ok) return parsed.error;
  // ¿Puede editarlo? (mismos permisos que «Editar» en la ficha)
  const deptKey = (await sectionDeptKeys())[section.key]!;
  const phase = (await deptStartPhases())[deptKey] ?? section.phase;
  if (!canEditSection(u, deptKey, phase, p)) return `«${field.label}» es de ${section.title} y solo puede cambiarlo su departamento (o el gestor de proyectos). Puedo avisarles o dejarlo como comentario.`;
  const refs = await sheetRefsFor(p.id, section.key);
  let referenceId: number | undefined;
  let refLabel: string | null = null;
  if (refs?.perRef) {
    const q = normalizeText(i.referencia ?? "");
    const r = q ? refs.refs.find((x) => normalizeText(x.label) === q || normalizeText(x.name).includes(q) || normalizeText(refTitle(x)).includes(q)) : undefined;
    if (!r) return `El proyecto tiene varias referencias (${refs.refs.map(refTitle).join(", ")}) y «${section.title}» va por referencia: pregunta en cuál.`;
    referenceId = r.id;
    refLabel = refTitle(r);
  }
  const shown = formatValue(field, parsed.value) ?? i.valor;
  return store(u, ch, "sheet_field", { subject, section: section.key, field: field.key, value: parsed.value, referenceId: referenceId ?? null }, {
    title: `Anotar en la ficha de ${subject.code}`,
    lines: [
      ["Proyecto", `${subject.code} · ${subject.name}${refLabel ? ` · ${refLabel}` : ""}`],
      ["Campo", `${field.label}${group ? ` · ${group}` : ""} (${section.title})`],
      ["Valor", shown],
    ],
  });
}

// ─── Bitácora de Laboratorio ───────────────────────────────────────────────

export const labNoteInput = z.object({
  sobre: z.string().min(1).max(120).describe("Código o nombre aproximado del proyecto NPD o de la reposición en reformulación"),
  nota: z.string().min(1).max(4000).describe("Lo que hay que apuntar en la bitácora"),
  espera: z.boolean().optional().describe("true si es una espera (el trabajo está parado) y la nota explica el motivo"),
});

export async function prepareLabNote(u: CurrentUser, ch: ActionChannel, i: z.infer<typeof labNoteInput>): Promise<PreparedAction | string> {
  const subject = await resolveSubject(u, i.sobre);
  if (!subject) return "Indica en qué proyecto o reposición.";
  if (!isSubject(subject)) return subjectProblem(subject, i.sobre);
  if (subject.kind === "project") {
    const p = await loadProjectRow(subject.id);
    const phase = (await deptStartPhases()).idi;
    if (!p || phase == null || !canEditSection(u, "idi", phase, p)) return "Solo Laboratorio / I+D (o el gestor de proyectos) puede escribir en su bitácora. Puedo dejarlo como comentario.";
  }
  return store(u, ch, "lab_note", { subject, body: i.nota.trim(), isWait: !!i.espera }, {
    title: `${i.espera ? "Espera" : "Nota"} en la bitácora de Laboratorio`,
    lines: [
      ["En", `${subject.code} · ${subject.name}`],
      [i.espera ? "Motivo de la espera" : "Nota", i.nota.trim()],
    ],
  });
}

// ─── Presupuesto de un proveedor (reposiciones) ───────────────────────────

export const quoteReplyInput = z.object({
  reposicion: z.string().min(1).max(60).describe("Código (REP-2026-0001) o nombre aproximado de la reposición"),
  proveedor: z.string().min(1).max(100).describe("Proveedor que ha respondido"),
  elemento: z.string().max(60).optional().describe("Elemento (etiqueta, estuche, caja master…) si el proveedor tiene varios en la reposición"),
  precio: z.string().max(20).optional().describe("Precio unitario en euros, solo el número (p. ej. «0,045»)"),
  notas: z.string().max(1000).optional().describe("Condiciones: plazo de entrega, mínimos, portes, validez…"),
});

export async function prepareQuoteReply(u: CurrentUser, ch: ActionChannel, i: z.infer<typeof quoteReplyInput>): Promise<PreparedAction | string> {
  const subject = await resolveSubject(u, i.reposicion);
  if (!subject) return "Indica la reposición.";
  if (!isSubject(subject)) return subjectProblem(subject, i.reposicion);
  if (subject.kind !== "replenishment") return `${subject.code} no es una reposición.`;
  const [rep] = await db.select({ requesterId: replenishments.requesterId }).from(replenishments).where(eq(replenishments.id, subject.id));
  if (!rep || !canActAs(u, rep, "compras")) return "Solo Compras (o quien abrió la reposición) registra los presupuestos.";
  const items = await db
    .select({ id: replenishmentItems.id, element: replenishmentItems.element, description: replenishmentItems.description, supplier: suppliers.name })
    .from(replenishmentItems)
    .innerJoin(suppliers, eq(suppliers.id, replenishmentItems.supplierId))
    .where(eq(replenishmentItems.replenishmentId, subject.id));
  const sq = searchTokens(i.proveedor);
  let mine = items.filter((it) => sq.every((t) => normalizeText(it.supplier).includes(t)));
  if (!mine.length) return `En ${subject.code} no hay elementos de «${i.proveedor}». Proveedores: ${[...new Set(items.map((x) => x.supplier))].join(", ") || "ninguno"}.`;
  if (i.elemento?.trim()) {
    const e = normalizeText(i.elemento);
    mine = mine.filter((it) => normalizeText(`${ELEMENT_LABEL[it.element] ?? it.element} ${it.description ?? ""}`).includes(e));
    if (!mine.length) return `«${i.proveedor}» no tiene «${i.elemento}» en ${subject.code}.`;
  }
  if (mine.length > 1 && i.precio) return `${mine[0]!.supplier} tiene varios elementos en ${subject.code} (${mine.map((x) => ELEMENT_LABEL[x.element] ?? x.element).join(", ")}): pregunta de cuál es el precio.`;
  const price = i.precio?.replace(/[^\d,.]/g, "") ?? "";
  if (price && !/^\d+([.,]\d{1,4})?$/.test(price)) return "El precio no es válido: indica solo el número (p. ej. 0,045).";
  if (!price && !i.notas?.trim()) return "Indica el precio o las condiciones del presupuesto.";
  return store(u, ch, "quote_reply", { subject, itemIds: mine.map((x) => x.id), price, notes: i.notas?.trim() ?? "" }, {
    title: `Presupuesto de ${mine[0]!.supplier}`,
    lines: [
      ["Reposición", `${subject.code} · ${subject.name}`],
      ["Elemento", mine.map((x) => ELEMENT_LABEL[x.element] ?? x.element).join(", ")],
      ...(price ? ([["Precio", `${price} €/ud`]] as [string, string][]) : []),
      ...(i.notas?.trim() ? ([["Condiciones", i.notas.trim()]] as [string, string][]) : []),
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

  if (a.kind === "sheet_field") {
    const r = await setSheetField(u, subject!.id, String(p.section), String(p.field), p.value, (p.referenceId as number | null) ?? undefined);
    const section = SHEET_SECTIONS.find((x) => x.key === p.section)!;
    const field = section.groups.flatMap((g) => g.fields).find((f) => f.key === p.field) as ScalarField;
    const before = formatValue(field, r.before);
    return `Anotado en la ficha de ${subject!.code}${r.refLabel ? ` (${r.refLabel})` : ""}: ${field.label} = ${formatValue(field, p.value) ?? "—"}${before ? ` (antes: ${before})` : ""}.`;
  }

  if (a.kind === "lab_note") {
    const body = String(p.body);
    const isWait = !!p.isWait;
    if (subject!.kind === "replenishment") await repLabNote(u, subject!.id, body, isWait);
    else {
      const proj = await loadProjectRow(subject!.id);
      const phase = (await deptStartPhases()).idi;
      if (!proj || phase == null || !canEditSection(u, "idi", phase, proj)) throw new Error("Solo Laboratorio / I+D puede escribir en su bitácora.");
      await db.insert(deptNotes).values({ projectId: subject!.id, departmentKey: "idi", body, isWait, authorId: u.id });
      await logActivity({ projectId: subject!.id, actorId: u.id, action: "dept.note", entity: "project", entityId: subject!.id, diff: { department: "idi", wait: isWait, via: "Alexia" } });
    }
    return `Apuntado en la bitácora de Laboratorio de ${subject!.code}.`;
  }

  if (a.kind === "quote_reply") {
    for (const itemId of p.itemIds as number[]) await registerQuote(u, { itemId, price: String(p.price ?? ""), notes: String(p.notes ?? "") || null });
    return `Presupuesto registrado en ${subject!.code}${p.price ? `: ${p.price} €/ud` : ""}.`;
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
