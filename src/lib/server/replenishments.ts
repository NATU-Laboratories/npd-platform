import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import {
  activityLog,
  departmentMembers,
  departments,
  projects,
  replenishmentCodeCounters,
  replenishmentFiles,
  replenishmentItems,
  replenishments,
  suppliers,
  users,
  type ReplenishmentStatus,
} from "@/db/schema";
import { getStorage } from "@/lib/graph/storage";
import { ELEMENT_LABEL, ELEMENTS, OPEN_REP_STATUSES, PRINTED_ELEMENTS, REP_STATUS_LABEL, REPLENISHMENT_TEMPLATES } from "@/lib/replenishment/config";
import { formatDate } from "@/lib/utils";
import { logActivity } from "./activity";
import { fuzzyMatch } from "./fuzzy";
import { AuthzError, hasRole, type CurrentUser } from "./authz";
import { renderEmail } from "./email-template";
import { logError } from "./errors";
import { queueNotification, uniqEmails } from "./notifications";
import { quoteReplyAddress } from "./reply-address";
import { addRepLabNote, startRepLab, transitionRepLab } from "./rep-lab";

// ─── Permisos ─────────────────────────────────────────────────────────────

const inDept = (u: CurrentUser, key: string) => u.departmentKeys.includes(key);
const isManager = (u: CurrentUser) => hasRole(u, "admin", "global_decider");

/** Quién ve el apartado de reposiciones. */
export function canAccessReplenishments(u: CurrentUser) {
  return isManager(u) || hasRole(u, "global_reader") || ["compras", "diseno", "calidad", "idi", "operaciones", "produccion"].some((k) => inDept(u, k));
}

/** La solicitud la abre Compras (y el admin / gestor de proyectos). */
export function canCreateReplenishment(u: CurrentUser) {
  return isManager(u) || inDept(u, "compras");
}

type Rep = typeof replenishments.$inferSelect;
export type RepRole = "diseno" | "calidad" | "compras" | "idi";

/** ¿Puede actuar como ese departamento en esta reposición? */
export function canActAs(u: CurrentUser, r: Pick<Rep, "requesterId">, role: RepRole) {
  if (isManager(u)) return true;
  if (role === "compras") return inDept(u, "compras") || r.requesterId === u.id;
  return inDept(u, role);
}

function assertAccess(u: CurrentUser) {
  if (!canAccessReplenishments(u)) throw new AuthzError("No tienes acceso a Reposiciones");
}

// ─── Destinatarios ────────────────────────────────────────────────────────

/** Emails de aviso del departamento (Backoffice) y, si no tiene, los de sus miembros activos. */
export async function departmentRecipients(keys: string[]) {
  if (!keys.length) return [];
  const [rows, members] = await Promise.all([
    db.select({ key: departments.key, emails: departments.notifyEmails }).from(departments).where(inArray(departments.key, keys)),
    db
      .select({ key: departments.key, email: users.email })
      .from(departmentMembers)
      .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
      .innerJoin(users, eq(users.id, departmentMembers.userId))
      .where(and(inArray(departments.key, keys), eq(users.status, "active"))),
  ]);
  return uniqEmails(keys.flatMap((k) => {
    const configured = rows.find((r) => r.key === k)?.emails ?? [];
    return configured.length ? configured : members.filter((m) => m.key === k).map((m) => m.email);
  }));
}

// ─── Emails (también para la vista previa) ────────────────────────────────

export type RepEmail = {
  key: string;
  audience: "internal" | "supplier";
  label: string;
  to: string[];
  replyTo?: string[];
  subject: string;
  html: string;
  supplierId?: number;
};

type EmailItem = { element: string; description?: string | null; quantity?: number | null; supplierName: string | null };
type EmailCtx = {
  id?: string;
  code: string;
  title: string;
  productName?: string | null;
  productRef?: string | null;
  clientOrBrand?: string | null;
  neededBy?: string | null;
  notes?: string | null;
  requesterName: string;
  requesterEmail: string;
  npdCode?: string | null;
  items: EmailItem[];
};

const SUBTITLE = "Laboratories · Reposiciones";
const itemLine = (i: EmailItem) =>
  `${ELEMENT_LABEL[i.element] ?? i.element}${i.description ? ` (${i.description})` : ""}${i.quantity ? ` · ${i.quantity.toLocaleString("es-ES")} uds` : ""}${i.supplierName ? ` · ${i.supplierName}` : ""}`;

function summaryRows(c: EmailCtx): [string, string][] {
  const rows: [string, string][] = [
    ["Código", c.code],
    ["Reposición", c.title],
    ["Plantilla", REPLENISHMENT_TEMPLATES.repeticion.label],
  ];
  if (c.productName) rows.push(["Producto", c.productName]);
  if (c.productRef) rows.push(["Referencia / EAN", c.productRef]);
  if (c.clientOrBrand) rows.push(["Cliente / marca", c.clientOrBrand]);
  if (c.npdCode) rows.push(["Proyecto NPD de origen", c.npdCode]);
  rows.push(["Elementos a reponer", c.items.map(itemLine).join("\n")]);
  rows.push(["Solicitado por", c.requesterName]);
  if (c.neededBy) rows.push(["Fecha necesaria", formatDate(c.neededBy)]);
  return rows;
}

const ctaPath = (c: EmailCtx) => (c.id ? `/reposiciones/${c.id}` : "/reposiciones");

/** Emails internos al abrir la solicitud: Diseño (tiene trabajo) y Calidad (aviso). */
async function creationInternalEmails(c: EmailCtx): Promise<RepEmail[]> {
  const [design, quality] = await Promise.all([departmentRecipients(["diseno"]), departmentRecipients(["calidad"])]);
  const msg = c.notes ? { label: "Notas de Compras", body: c.notes } : null;
  return [
    {
      key: "dept.diseno",
      audience: "internal",
      label: "Diseño",
      to: design,
      subject: `[${c.code}] Reposición: revisa el diseño · ${c.title}`,
      html: renderEmail({
        title: "Nueva reposición: tienes trabajo",
        intro: `${c.requesterName} ha abierto una reposición. Revisa si hay cambios de diseño y prepara el arte final que se enviará a imprenta; después lo validará Calidad.`,
        message: msg,
        extraRows: summaryRows(c),
        ctaPath: ctaPath(c),
        ctaLabel: "Revisar el diseño",
        subtitle: SUBTITLE,
      }),
    },
    {
      key: "dept.calidad",
      audience: "internal",
      label: "Calidad",
      to: quality,
      subject: `[${c.code}] Nueva reposición en marcha · ${c.title}`,
      html: renderEmail({
        title: "Nueva reposición en marcha",
        intro: "Cuando Diseño entregue el arte final, te tocará validarlo antes de enviarlo a imprenta. Te avisaremos entonces.",
        message: msg,
        extraRows: summaryRows(c),
        ctaPath: ctaPath(c),
        subtitle: SUBTITLE,
      }),
    },
  ];
}

/** Email a un proveedor pidiéndole la recotización de sus elementos. */
function supplierQuoteEmail(c: EmailCtx, s: { id: number; name: string; emails: string[]; contactName?: string | null }, items: EmailItem[], message: string, replyTo: string[]): RepEmail {
  const rows: [string, string][] = [["Referencia NATU", c.code]];
  if (c.productName) rows.push(["Producto", c.productName]);
  if (c.productRef) rows.push(["Referencia / EAN", c.productRef]);
  rows.push(["Materiales", items.map((i) => itemLine({ ...i, supplierName: null })).join("\n")]);
  if (c.neededBy) rows.push(["Fecha necesaria", formatDate(c.neededBy)]);
  rows.push(["Contacto en NATU", `${c.requesterName} · ${c.requesterEmail}`]);
  return {
    key: `supplier.${s.id}`,
    audience: "supplier",
    label: s.name,
    supplierId: s.id,
    to: uniqEmails(s.emails),
    replyTo,
    subject: `Solicitud de recotización · ${c.productName || c.title} · ${c.code}`,
    html: renderEmail({
      title: "Solicitud de recotización",
      intro: `Hola${s.contactName ? ` ${s.contactName}` : ""}, desde Laboratorios NatuAromatic (NATU) necesitamos reponer los siguientes materiales. ¿Nos podéis enviar la cotización actualizada y el plazo de entrega?`,
      message: message.trim() ? { label: `Mensaje de ${c.requesterName}`, body: message.trim() } : null,
      extraRows: rows,
      ctaPath: null,
      subtitle: "Laboratories · Compras",
      footer: "Laboratorios NatuAromatic S.L. · Responde a este correo para enviar la cotización a nuestro equipo de Compras.",
    }),
  };
}

/** Email a un proveedor al enviar a imprenta (confirmación de pedido). */
function supplierPrintEmail(c: EmailCtx, s: { id: number; name: string; emails: string[]; contactName?: string | null }, items: EmailItem[], message: string, replyTo: string[]): RepEmail {
  const rows: [string, string][] = [["Referencia NATU", c.code]];
  if (c.productName) rows.push(["Producto", c.productName]);
  rows.push(["Materiales", items.map((i) => itemLine({ ...i, supplierName: null })).join("\n")]);
  if (c.neededBy) rows.push(["Fecha necesaria", formatDate(c.neededBy)]);
  rows.push(["Contacto en NATU", `${c.requesterName} · ${c.requesterEmail}`]);
  return {
    key: `supplier.${s.id}`,
    audience: "supplier",
    label: s.name,
    supplierId: s.id,
    to: uniqEmails(s.emails),
    replyTo,
    subject: `Arte final aprobado: enviar a imprenta · ${c.productName || c.title} · ${c.code}`,
    html: renderEmail({
      title: "Arte final aprobado",
      intro: `Hola${s.contactName ? ` ${s.contactName}` : ""}, os confirmamos que el arte final de estos materiales está aprobado y podéis proceder con la impresión.`,
      message: message.trim() ? { label: `Mensaje de ${c.requesterName}`, body: message.trim() } : null,
      extraRows: rows,
      ctaPath: null,
      subtitle: "Laboratories · Compras",
      footer: "Laboratorios NatuAromatic S.L. · Responde a este correo para contactar con nuestro equipo de Compras.",
    }),
  };
}

async function replyToFor(requesterEmail: string) {
  return uniqEmails([requesterEmail, ...(await departmentRecipients(["compras"]))]);
}

type SupplierRow = typeof suppliers.$inferSelect;

/** Agrupa los elementos por proveedor (solo proveedores con email). */
function bySupplier<T extends { supplierId: number | null }>(items: T[], list: SupplierRow[]) {
  return list
    .map((s) => ({ s, items: items.filter((i) => i.supplierId === s.id) }))
    .filter((g) => g.items.length);
}

// ─── Solicitud nueva ──────────────────────────────────────────────────────

const itemInput = z.object({
  element: z.enum(ELEMENTS.map((e) => e.key) as [string, ...string[]]),
  description: z.string().trim().max(300).optional().nullable(),
  quantity: z.number().int().min(1).max(100_000_000).optional().nullable(),
  supplierId: z.number().int().positive().optional().nullable(),
  newSupplier: z
    .object({ name: z.string().trim().min(1).max(200), email: z.union([z.literal(""), z.string().trim().email("Email del proveedor no válido")]).optional() })
    .optional()
    .nullable(),
});

export const newReplenishmentSchema = z.object({
  template: z.literal("repeticion"),
  title: z.string().trim().min(1, "Pon un título a la reposición").max(200),
  npdProjectId: z.string().uuid().optional().nullable(),
  productName: z.string().trim().max(200).optional().nullable(),
  productRef: z.string().trim().max(100).optional().nullable(),
  clientOrBrand: z.string().trim().max(200).optional().nullable(),
  neededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  items: z.array(itemInput).min(1, "Indica al menos un elemento a reponer").max(30),
  sendSupplierEmails: z.boolean(),
  supplierMessage: z.string().max(4000).default(""),
});
export type NewReplenishment = z.infer<typeof newReplenishmentSchema>;

function validateItems(items: NewReplenishment["items"]) {
  items.forEach((i, n) => {
    if (!i.supplierId && !i.newSupplier?.name) throw new Error(`Indica el proveedor del elemento ${n + 1} (${ELEMENT_LABEL[i.element]})`);
    if (i.element === "otro" && !i.description?.trim()) throw new Error(`Describe el elemento ${n + 1} («Otro»)`);
  });
}

async function nextRepCode(tx: DbOrTx) {
  const year = Number(new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid", year: "numeric" }));
  const [row] = await tx
    .insert(replenishmentCodeCounters)
    .values({ year, last: 1 })
    .onConflictDoUpdate({ target: replenishmentCodeCounters.year, set: { last: sql`${replenishmentCodeCounters.last} + 1` } })
    .returning({ last: replenishmentCodeCounters.last });
  return `REP-${year}-${String(row!.last).padStart(4, "0")}`;
}

async function npdCode(id?: string | null) {
  if (!id) return null;
  const [p] = await db.select({ code: projects.code, name: projects.name }).from(projects).where(eq(projects.id, id));
  return p ? `${p.code ?? "(borrador)"} · ${p.name}` : null;
}

/** Vista previa de los emails que se enviarán al crear la solicitud (sin guardar nada). */
export async function previewCreationEmails(u: CurrentUser, raw: unknown): Promise<RepEmail[]> {
  if (!canCreateReplenishment(u)) throw new AuthzError("Solo Compras puede abrir reposiciones");
  const input = newReplenishmentSchema.parse(raw);
  const ids = input.items.map((i) => i.supplierId).filter((x): x is number => !!x);
  const existing = ids.length ? await db.select().from(suppliers).where(inArray(suppliers.id, ids)) : [];
  // Proveedores nuevos (aún sin id): ids negativos solo para la vista previa
  const fresh: SupplierRow[] = [];
  const items = input.items.map((i, n) => {
    let supplierId = i.supplierId ?? null;
    if (!supplierId && i.newSupplier?.name) {
      const name = i.newSupplier.name.trim();
      let s = fresh.find((f) => f.name.toLowerCase() === name.toLowerCase());
      if (!s) {
        s = { id: -(n + 1), name, emails: i.newSupplier.email ? [i.newSupplier.email] : [], contactName: null, phone: null, notes: null, isActive: true, createdAt: new Date() };
        fresh.push(s);
      }
      supplierId = s.id;
    }
    return { ...i, supplierId };
  });
  const all = [...existing, ...fresh];
  const ctx: EmailCtx = {
    code: "REP (se asigna al crear)",
    title: input.title,
    productName: input.productName,
    productRef: input.productRef,
    clientOrBrand: input.clientOrBrand,
    neededBy: input.neededBy,
    notes: input.notes,
    requesterName: u.name,
    requesterEmail: u.email,
    npdCode: await npdCode(input.npdProjectId),
    items: items.map((i) => ({ ...i, supplierName: all.find((s) => s.id === i.supplierId)?.name ?? null })),
  };
  const out = await creationInternalEmails(ctx);
  if (input.sendSupplierEmails) {
    const replyTo = await replyToFor(u.email);
    for (const g of bySupplier(items, all)) out.push(supplierQuoteEmail(ctx, g.s, g.items.map((i) => ({ ...i, supplierName: null })), input.supplierMessage, replyTo));
  }
  return out;
}

/** Busca o crea un proveedor por nombre (los nuevos se dan de alta al crear la solicitud). */
async function resolveSupplier(tx: DbOrTx, n: { name: string; email?: string }) {
  const name = n.name.trim();
  const [found] = await tx.select().from(suppliers).where(sql`lower(${suppliers.name}) = ${name.toLowerCase()}`);
  if (found) {
    if (n.email && !found.emails.includes(n.email.toLowerCase())) {
      await tx.update(suppliers).set({ emails: [...found.emails, n.email.toLowerCase()] }).where(eq(suppliers.id, found.id));
    }
    return found.id;
  }
  const [row] = await tx
    .insert(suppliers)
    .values({ name, emails: n.email ? [n.email.toLowerCase()] : [] })
    .returning({ id: suppliers.id });
  return row!.id;
}

export async function createReplenishment(u: CurrentUser, raw: unknown) {
  if (!canCreateReplenishment(u)) throw new AuthzError("Solo Compras puede abrir reposiciones");
  const input = newReplenishmentSchema.parse(raw);
  validateItems(input.items);
  const { id, code } = await db.transaction(async (tx) => {
    const code = await nextRepCode(tx);
    const [r] = await tx
      .insert(replenishments)
      .values({
        code,
        template: input.template,
        title: input.title,
        npdProjectId: input.npdProjectId ?? null,
        productName: input.productName || null,
        productRef: input.productRef || null,
        clientOrBrand: input.clientOrBrand || null,
        neededBy: input.neededBy || null,
        notes: input.notes || null,
        requesterId: u.id,
      })
      .returning({ id: replenishments.id });
    for (const [n, i] of input.items.entries()) {
      const supplierId = i.supplierId ?? (i.newSupplier ? await resolveSupplier(tx, { name: i.newSupplier.name, email: i.newSupplier.email || undefined }) : null);
      await tx.insert(replenishmentItems).values({
        replenishmentId: r!.id,
        element: i.element,
        description: i.description || null,
        quantity: i.quantity ?? null,
        supplierId,
        sort: n,
      });
    }
    await logActivity(
      { actorId: u.id, action: "replenishment.created", entity: "replenishment", entityId: r!.id, diff: { code, items: input.items.length, sendSupplierEmails: input.sendSupplierEmails } },
      tx,
    );
    return { id: r!.id, code };
  });

  try {
    const ctx = await emailCtx(id);
    for (const e of await creationInternalEmails(ctx)) await queue(id, "replenishment.created", e);
    if (input.sendSupplierEmails) await sendQuoteRequests(u, id, null, input.supplierMessage);
  } catch (err) {
    await logError("replenishment:notify", err, { id });
  }
  return { id, code };
}

async function queue(id: string, event: string, e: RepEmail) {
  if (!e.to.length) return null;
  return queueNotification({ event, replenishmentId: id, recipients: e.to, replyTo: e.replyTo, subject: e.subject, html: e.html });
}

async function emailCtx(id: string): Promise<EmailCtx & { rep: Rep; itemRows: (typeof replenishmentItems.$inferSelect)[]; supplierRows: SupplierRow[] }> {
  const [row] = await db
    .select({ r: replenishments, requesterName: users.name, requesterEmail: users.email })
    .from(replenishments)
    .innerJoin(users, eq(users.id, replenishments.requesterId))
    .where(eq(replenishments.id, id));
  if (!row) throw new Error("Reposición no encontrada");
  const itemRows = await db.select().from(replenishmentItems).where(eq(replenishmentItems.replenishmentId, id)).orderBy(asc(replenishmentItems.sort));
  const sIds = [...new Set(itemRows.map((i) => i.supplierId).filter((x): x is number => !!x))];
  const supplierRows = sIds.length ? await db.select().from(suppliers).where(inArray(suppliers.id, sIds)) : [];
  const r = row.r;
  return {
    rep: r,
    itemRows,
    supplierRows,
    id: r.id,
    code: r.code,
    title: r.title,
    productName: r.productName,
    productRef: r.productRef,
    clientOrBrand: r.clientOrBrand,
    neededBy: r.neededBy,
    notes: r.notes,
    requesterName: row.requesterName,
    requesterEmail: row.requesterEmail,
    npdCode: await npdCode(r.npdProjectId),
    items: itemRows.map((i) => ({ ...i, supplierName: supplierRows.find((s) => s.id === i.supplierId)?.name ?? null })),
  };
}

// ─── Proveedor: recotización y envío a imprenta ───────────────────────────

/** Emails a proveedores (recotización o envío a imprenta), para vista previa o envío. */
export async function supplierEmails(u: CurrentUser, id: string, kind: "quote" | "print", supplierId: number | null, message: string) {
  assertAccess(u);
  const c = await emailCtx(id);
  const replyTo = await replyToFor(c.requesterEmail);
  const sender = { ...c, requesterName: u.name, requesterEmail: u.email };
  const groups = bySupplier(c.itemRows, c.supplierRows).filter((g) => supplierId == null || g.s.id === supplierId);
  return groups.map((g) => {
    // Recotización: la respuesta va primero a la dirección de Alexia (la lee, anota el presupuesto y avisa a Compras)
    const alexia = kind === "quote" ? quoteReplyAddress(id, g.s.id) : null;
    return (kind === "quote" ? supplierQuoteEmail : supplierPrintEmail)(sender, g.s, g.items.map((i) => ({ ...i, supplierName: null })), message, uniqEmails([alexia, u.email, ...replyTo]));
  });
}

export async function sendQuoteRequests(u: CurrentUser, id: string, supplierId: number | null, message: string) {
  const c = await emailCtx(id);
  if (!canActAs(u, c.rep, "compras")) throw new AuthzError("Solo Compras puede pedir recotizaciones");
  const emails = await supplierEmails(u, id, "quote", supplierId, message);
  const sent: string[] = [];
  for (const e of emails) {
    if (!e.to.length) continue;
    await queue(id, "replenishment.quote_requested", e);
    await db
      .update(replenishmentItems)
      .set({ quoteStatus: "requested", quoteRequestedAt: new Date() })
      .where(and(eq(replenishmentItems.replenishmentId, id), eq(replenishmentItems.supplierId, e.supplierId!), sql`${replenishmentItems.quoteStatus} <> 'received'`));
    sent.push(e.label);
  }
  if (sent.length) await logActivity({ actorId: u.id, action: "replenishment.quote_requested", entity: "replenishment", entityId: id, diff: { suppliers: sent } });
  return { sent, withoutEmail: emails.filter((e) => !e.to.length).map((e) => e.label) };
}

const quoteSchema = z.object({
  itemId: z.number().int().positive(),
  price: z.union([z.literal(""), z.string().trim().regex(/^\d+([.,]\d{1,4})?$/, "Precio no válido")]),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export async function registerQuote(u: CurrentUser, raw: unknown) {
  const q = quoteSchema.parse(raw);
  const [row] = await db.select({ i: replenishmentItems, r: replenishments }).from(replenishmentItems).innerJoin(replenishments, eq(replenishments.id, replenishmentItems.replenishmentId)).where(eq(replenishmentItems.id, q.itemId));
  if (!row) throw new Error("Elemento no encontrado");
  if (!canActAs(u, row.r, "compras")) throw new AuthzError("Solo Compras registra las recotizaciones");
  const price = q.price ? q.price.replace(",", ".") : null;
  await db
    .update(replenishmentItems)
    .set({ quotePrice: price, quoteNotes: q.notes || null, quoteStatus: price || q.notes ? "received" : row.i.quoteStatus, quoteReceivedAt: price || q.notes ? new Date() : row.i.quoteReceivedAt })
    .where(eq(replenishmentItems.id, q.itemId));
  await logActivity({ actorId: u.id, action: "replenishment.quote_received", entity: "replenishment", entityId: row.r.id, diff: { element: ELEMENT_LABEL[row.i.element], price } });
  return row.r.id;
}

const itemEdit = z.object({
  itemId: z.number().int().positive(),
  supplierId: z.number().int().positive().nullable(),
  newSupplier: itemInput.shape.newSupplier,
  quantity: z.number().int().min(1).max(100_000_000).nullable(),
  description: z.string().trim().max(300).nullable(),
});

export async function updateItem(u: CurrentUser, raw: unknown) {
  const e = itemEdit.parse(raw);
  const [row] = await db.select({ i: replenishmentItems, r: replenishments }).from(replenishmentItems).innerJoin(replenishments, eq(replenishments.id, replenishmentItems.replenishmentId)).where(eq(replenishmentItems.id, e.itemId));
  if (!row) throw new Error("Elemento no encontrado");
  if (!canActAs(u, row.r, "compras")) throw new AuthzError("Solo Compras edita los elementos");
  if (!OPEN_REP_STATUSES.includes(row.r.status)) throw new Error("La reposición está cerrada");
  await db.transaction(async (tx) => {
    const supplierId = e.supplierId ?? (e.newSupplier?.name ? await resolveSupplier(tx, { name: e.newSupplier.name, email: e.newSupplier.email || undefined }) : null);
    if (!supplierId) throw new Error("Indica el proveedor del elemento");
    const changedSupplier = supplierId !== row.i.supplierId;
    await tx
      .update(replenishmentItems)
      .set({ supplierId, quantity: e.quantity, description: e.description || null, ...(changedSupplier ? { quoteStatus: "pending", quotePrice: null, quoteRequestedAt: null, quoteReceivedAt: null } : {}) })
      .where(eq(replenishmentItems.id, e.itemId));
    await logActivity({ actorId: u.id, action: "replenishment.edited", entity: "replenishment", entityId: row.r.id, diff: { element: ELEMENT_LABEL[row.i.element], supplierChanged: changedSupplier } }, tx);
  });
  return row.r.id;
}

// ─── Flujo (plantilla «Repetición») ───────────────────────────────────────

export const REP_ACTIONS = ["design_no_changes", "design_changes", "design_ready", "quality_approved", "quality_corrections", "quality_reformulate", "lab_reformulated", "sent_to_print", "close", "cancel"] as const;
export type RepAction = (typeof REP_ACTIONS)[number];

const FLOW: Record<RepAction, { from: ReplenishmentStatus[]; to: ReplenishmentStatus; role: RepRole; label: string; needsComment?: boolean }> = {
  design_no_changes: { from: ["design_review"], to: "quality_review", role: "diseno", label: "Sin cambios: arte final listo" },
  design_changes: { from: ["design_review"], to: "design_changes", role: "diseno", label: "Hay cambios de diseño" },
  design_ready: { from: ["design_changes"], to: "quality_review", role: "diseno", label: "Arte final corregido: enviar a Calidad" },
  quality_approved: { from: ["quality_review"], to: "art_approved", role: "calidad", label: "Validar arte final" },
  quality_corrections: { from: ["quality_review"], to: "design_changes", role: "calidad", label: "Pedir correcciones", needsComment: true },
  quality_reformulate: { from: ["quality_review"], to: "reformulation", role: "calidad", label: "Reformular", needsComment: true },
  lab_reformulated: { from: ["reformulation"], to: "quality_review", role: "idi", label: "Reformulación terminada: devolver a Calidad", needsComment: true },
  sent_to_print: { from: ["art_approved"], to: "sent_to_print", role: "compras", label: "Enviado a imprenta" },
  close: { from: ["sent_to_print"], to: "closed", role: "compras", label: "Cerrar (material recibido)" },
  cancel: { from: OPEN_REP_STATUSES, to: "cancelled", role: "compras", label: "Cancelar reposición", needsComment: true },
};
export const REP_FLOW = FLOW;

/** Acciones disponibles para el usuario en el estado actual. */
export function availableActions(u: CurrentUser, r: Pick<Rep, "status" | "requesterId">): RepAction[] {
  // «Reformulación terminada» la lanza Laboratorio al completar su estado final (no es un botón)
  return REP_ACTIONS.filter((a) => a !== "lab_reformulated" && FLOW[a].from.includes(r.status) && canActAs(u, r, FLOW[a].role));
}

/** Elementos impresos de la reposición (los que necesitan arte final). */
const needsArt = (items: { element: string }[]) => items.some((i) => PRINTED_ELEMENTS.includes(i.element));

export type Correction = { text: string; fileIds: number[] };

export async function transition(
  u: CurrentUser,
  id: string,
  action: RepAction,
  opts: { comment?: string | null; sendSupplierEmails?: boolean; supplierMessage?: string; corrections?: Correction[]; fromLab?: boolean } = {},
) {
  const step = FLOW[action];
  if (!step) throw new Error("Acción no válida");
  if (action === "lab_reformulated" && !opts.fromLab) throw new Error("La reformulación termina cuando Laboratorio completa su último estado");
  const c = await emailCtx(id);
  const r = c.rep;
  if (!step.from.includes(r.status)) throw new Error(`La reposición está en «${REP_STATUS_LABEL[r.status]}»: no se puede hacer esto ahora`);
  if (!canActAs(u, r, step.role)) throw new AuthzError("No tienes permiso para esta acción");
  // Correcciones de Calidad: una a una, con texto y capturas (solo capturas de esta reposición)
  let corrections: Correction[] = [];
  if (action === "quality_corrections" && opts.corrections?.length) {
    const parsed = z
      .array(z.object({ text: z.string().trim().max(2000), fileIds: z.array(z.number().int().positive()).max(10) }))
      .max(30)
      .parse(opts.corrections)
      .filter((x) => x.text || x.fileIds.length);
    const ids = parsed.flatMap((x) => x.fileIds);
    const valid = ids.length
      ? new Set((await db.select({ id: replenishmentFiles.id }).from(replenishmentFiles).where(and(eq(replenishmentFiles.replenishmentId, id), inArray(replenishmentFiles.id, ids)))).map((f) => f.id))
      : new Set<number>();
    corrections = parsed.map((x) => ({ text: x.text, fileIds: x.fileIds.filter((f) => valid.has(f)) }));
    if (corrections.some((x) => !x.text)) throw new Error("Cada corrección necesita una indicación de qué hay que cambiar");
  }
  const comment =
    opts.comment?.trim() || (corrections.length ? corrections.map((x, n) => `${n + 1}. ${x.text}${x.fileIds.length ? ` (${x.fileIds.length} captura${x.fileIds.length > 1 ? "s" : ""})` : ""}`).join("\n") : null);
  if (step.needsComment && !comment)
    throw new Error(action === "cancel" ? "Indica el motivo de la cancelación" : action === "quality_reformulate" ? "Explica qué hay que reformular y por qué" : action === "lab_reformulated" ? "Indica qué se ha reformulado" : "Añade al menos una corrección");

  // Para pasar a Calidad tiene que haber arte final (de esta ronda si ha habido correcciones)
  if ((action === "design_no_changes" || action === "design_ready") && needsArt(c.itemRows)) {
    const arts = await db
      .select({ round: replenishmentFiles.round })
      .from(replenishmentFiles)
      .where(and(eq(replenishmentFiles.replenishmentId, id), eq(replenishmentFiles.tag, "arte_final")));
    const ok = action === "design_no_changes" ? arts.length > 0 : arts.some((a) => a.round === r.round);
    if (!ok) throw new Error(action === "design_no_changes" ? "Añade el enlace al arte final antes de enviarlo a Calidad" : `Añade el enlace al arte final corregido (ronda ${r.round}) antes de enviarlo a Calidad`);
  }

  const now = new Date();
  const round = action === "quality_corrections" ? r.round + 1 : r.round;
  await db.transaction(async (tx) => {
    await tx
      .update(replenishments)
      .set({ status: step.to, round, updatedAt: now, ...(step.to === "closed" || step.to === "cancelled" ? { closedAt: now } : {}) })
      .where(and(eq(replenishments.id, id), eq(replenishments.status, r.status)));
    if (action === "quality_reformulate") await startRepLab(tx, r, now);
    await logActivity(
      { actorId: u.id, action: action === "close" ? "replenishment.closed" : action === "cancel" ? "replenishment.cancelled" : `replenishment.${action}`, entity: "replenishment", entityId: id, diff: { from: r.status, to: step.to, comment, round, ...(corrections.length ? { corrections } : {}) } },
      tx,
    );
  });

  // Avisos: solo a quien le toca trabajar ahora
  try {
    const ctx = { ...c, requesterName: c.requesterName };
    const msg = comment ? { label: action === "cancel" ? "Motivo" : `Comentario de ${u.name}`, body: comment } : null;
    const internal = async (event: string, keys: string[], extra: string[], title: string, intro: string, cta?: string) => {
      const to = uniqEmails([...(await departmentRecipients(keys)), ...extra]).filter((e) => e !== u.email.toLowerCase());
      await queue(id, event, {
        key: event,
        audience: "internal",
        label: title,
        to,
        subject: `[${c.code}] ${title} · ${c.title}`,
        html: renderEmail({ title, intro, message: msg, extraRows: summaryRows(ctx), ctaPath: ctaPath(ctx), ctaLabel: cta, subtitle: SUBTITLE }),
      });
    };
    if (step.to === "quality_review" && action !== "lab_reformulated")
      await internal("replenishment.quality_review", ["calidad"], [], "Arte final listo para validar", `${u.name} (Diseño) ha entregado el arte final. Revísalo y valídalo o pide correcciones.`, "Validar el arte final");
    if (action === "quality_reformulate")
      await internal("replenishment.reformulation", ["idi"], [c.requesterEmail], "Reformulación pedida por Calidad", `${u.name} (Calidad) pide reformular el producto. Laboratorio / I+D entra en la reposición: revisa los comentarios de reformulación y, al terminar, devuélvela a Calidad.`, "Ver la reformulación");
    if (action === "lab_reformulated")
      await internal("replenishment.reformulated", ["calidad"], [c.requesterEmail], "Reformulación terminada", `${u.name} (Laboratorio / I+D) ha terminado la reformulación. Calidad debe volver a validar (y pedir correcciones del arte final si cambia el etiquetado).`, "Validar de nuevo");
    if (action === "quality_corrections")
      await internal("replenishment.corrections", ["diseno"], [], "Correcciones en el arte final", `Calidad pide ${corrections.length > 1 ? `${corrections.length} correcciones` : "correcciones"} (ronda ${round}). Revísalas en la plataforma (con sus capturas), añade el enlace al arte final corregido y vuelve a enviarlo.`, "Ver las correcciones");
    if (action === "quality_approved")
      await internal("replenishment.art_approved", ["compras"], [c.requesterEmail], "Arte final aprobado", "Calidad ha validado el arte final. Ya puedes enviarlo a imprenta.", "Enviar a imprenta");
    if (action === "cancel") await internal("replenishment.cancelled", ["diseno", "calidad", "compras", ...(r.status === "reformulation" ? ["idi"] : [])], [c.requesterEmail], "Reposición cancelada", `${u.name} ha cancelado la reposición.`);
    if (action === "sent_to_print" && opts.sendSupplierEmails) {
      for (const e of await supplierEmails(u, id, "print", null, opts.supplierMessage ?? "")) await queue(id, "replenishment.sent_to_print", e);
    }
  } catch (err) {
    await logError("replenishment:notify", err, { id, action });
  }
}

// ─── Reformulación (Laboratorio / I+D) ────────────────────────────────────

async function repForLab(u: CurrentUser, id: string) {
  assertAccess(u);
  const [r] = await db.select().from(replenishments).where(eq(replenishments.id, id));
  if (!r) throw new Error("Reposición no encontrada");
  if (!canActAs(u, r, "idi")) throw new AuthzError("Solo Laboratorio / I+D puede hacer esto");
  return r;
}

/** Laboratorio avanza o retrocede su estado; al completar el último, la reposición vuelve a Calidad. */
export async function repLabTransition(u: CurrentUser, id: string, targetId: number, comment: string | null, lab: unknown) {
  const r = await repForLab(u, id);
  const text = z.string().trim().max(4000).nullable().parse(comment ?? null) || null;
  const res = await transitionRepLab(u, r, targetId, text, lab);
  if (res.completed)
    await transition(u, id, "lab_reformulated", {
      fromLab: true,
      comment: [res.approved.length ? `Referencia aprobada: ${res.approved.join(", ")}` : null, text].filter(Boolean).join("\n") || "Reformulación terminada",
    });
  return res;
}

export async function repLabNote(u: CurrentUser, id: string, body: string, isWait: boolean) {
  const r = await repForLab(u, id);
  if (["closed", "cancelled"].includes(r.status)) throw new Error("La reposición está cerrada");
  await addRepLabNote(u, r, body, isWait);
}

// ─── Comentarios ──────────────────────────────────────────────────────────

export async function addComment(u: CurrentUser, id: string, body: string) {
  assertAccess(u);
  const text = z.string().trim().min(1, "Escribe un comentario").max(4000).parse(body);
  const [r] = await db.select({ id: replenishments.id }).from(replenishments).where(eq(replenishments.id, id));
  if (!r) throw new Error("Reposición no encontrada");
  await logActivity({ actorId: u.id, action: "replenishment.comment", entity: "replenishment", entityId: id, diff: { body: text } });
}

// ─── Archivos ─────────────────────────────────────────────────────────────

export async function repFolder(id: string) {
  const [r] = await db.select().from(replenishments).where(eq(replenishments.id, id));
  if (!r) throw new Error("Reposición no encontrada");
  if (r.storageFolderId) return { r, folderId: r.storageFolderId };
  const storage = getStorage();
  const root = await storage.ensureFolder(await storage.rootId(), "Reposiciones");
  const folder = await storage.ensureFolder(root.id, [r.code, r.productName || r.title].filter(Boolean).join(". ").slice(0, 120));
  await db.update(replenishments).set({ storageFolderId: folder.id }).where(eq(replenishments.id, id));
  return { r, folderId: folder.id };
}

// ─── Consultas ────────────────────────────────────────────────────────────

export async function listReplenishments(u: CurrentUser, f: { q?: string; status?: string; mine?: boolean }) {
  assertAccess(u);
  const conds: SQL[] = [];
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`;
    const fuzzy = fuzzyMatch(f.q, [replenishments.code, replenishments.title, replenishments.productName, replenishments.productRef, replenishments.clientOrBrand]);
    conds.push(
      or(
        ilike(replenishments.code, like),
        ilike(replenishments.title, like),
        ilike(replenishments.productName, like),
        ilike(replenishments.productRef, like),
        ilike(replenishments.clientOrBrand, like),
        ...(fuzzy ? [fuzzy] : []),
      )!,
    );
  }
  if (f.status === "abiertas") conds.push(inArray(replenishments.status, OPEN_REP_STATUSES));
  else if (f.status && f.status in REP_STATUS_LABEL) conds.push(eq(replenishments.status, f.status as ReplenishmentStatus));
  if (f.mine) conds.push(eq(replenishments.requesterId, u.id));
  const rows = await db
    .select({ r: replenishments, requester: users.name })
    .from(replenishments)
    .innerJoin(users, eq(users.id, replenishments.requesterId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(replenishments.createdAt))
    .limit(200);
  const ids = rows.map((x) => x.r.id);
  const items = ids.length
    ? await db
        .select({ rid: replenishmentItems.replenishmentId, element: replenishmentItems.element, supplier: suppliers.name, quoteStatus: replenishmentItems.quoteStatus })
        .from(replenishmentItems)
        .leftJoin(suppliers, eq(suppliers.id, replenishmentItems.supplierId))
        .where(inArray(replenishmentItems.replenishmentId, ids))
    : [];
  return rows.map(({ r, requester }) => {
    const its = items.filter((i) => i.rid === r.id);
    return {
      ...r,
      requester,
      elements: its.map((i) => ELEMENT_LABEL[i.element] ?? i.element),
      suppliers: [...new Set(its.map((i) => i.supplier).filter(Boolean))] as string[],
      quotesPending: its.filter((i) => i.quoteStatus !== "received").length,
    };
  });
}

/** ¿Le toca a esta persona? (para resaltar en el listado) */
export function myTurn(u: CurrentUser, r: Pick<Rep, "status" | "requesterId">) {
  return availableActions(u, r).some((a) => a !== "cancel");
}

export async function loadReplenishment(u: CurrentUser, id: string) {
  assertAccess(u);
  const c = await emailCtx(id).catch(() => null);
  if (!c) return null;
  const [files, activity, npd] = await Promise.all([
    db.select({ f: replenishmentFiles, by: users.name }).from(replenishmentFiles).innerJoin(users, eq(users.id, replenishmentFiles.uploadedBy)).where(eq(replenishmentFiles.replenishmentId, id)).orderBy(desc(replenishmentFiles.createdAt)),
    db
      .select({ a: activityLog, who: users.name })
      .from(activityLog)
      .leftJoin(users, eq(users.id, activityLog.actorId))
      .where(and(eq(activityLog.entity, "replenishment"), eq(activityLog.entityId, id)))
      .orderBy(desc(activityLog.createdAt))
      .limit(100),
    c.rep.npdProjectId ? db.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects).where(eq(projects.id, c.rep.npdProjectId)) : Promise.resolve([]),
  ]);
  return { ...c, files, activity, npd: npd[0] ?? null, actions: availableActions(u, c.rep) };
}

/** Elementos y proveedores de la última reposición del mismo proyecto NPD (para precargar). */
export async function lastItemsForProject(u: CurrentUser, npdProjectId: string) {
  assertAccess(u);
  const [last] = await db
    .select({ id: replenishments.id, code: replenishments.code })
    .from(replenishments)
    .where(eq(replenishments.npdProjectId, npdProjectId))
    .orderBy(desc(replenishments.createdAt))
    .limit(1);
  if (!last) return null;
  const items = await db.select().from(replenishmentItems).where(eq(replenishmentItems.replenishmentId, last.id)).orderBy(asc(replenishmentItems.sort));
  return { code: last.code, items: items.map((i) => ({ element: i.element, description: i.description, quantity: i.quantity, supplierId: i.supplierId })) };
}
