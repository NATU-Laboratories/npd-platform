import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { componentQuotes, projectComponents, projects, suppliers, users, type Project } from "@/db/schema";
import { COMPONENT_KEYS, COMPONENT_LABEL, componentLabel, MAX_SUPPLIERS } from "@/lib/purchasing/components";
import { logActivity } from "./activity";
import { AuthzError, isAdmin, isGlobalDecider, type CurrentUser } from "./authz";
import { renderEmail } from "./email-template";
import { queueNotification, uniqEmails } from "./notifications";
import { departmentRecipients, resolveSupplier, type RepEmail } from "./replenishments";
import { inboxMailbox, quoteReplyAddress } from "./reply-address";
import { sectionDeptKeys } from "./sheet";

/**
 * Desglose de componentes del proyecto (Compras / Aprovisionamiento). Cada componente se cotiza
 * con hasta 3 proveedores (por email, con la dirección de respuesta de Alexia) y Compras elige uno.
 */

export class PurchasingError extends Error {}

/** Departamento de Compras: el que lleva el apartado «Aprovisionamiento» (reasignable en Backoffice). */
export async function purchasingDeptKey() {
  return (await sectionDeptKeys()).aprovisionamiento ?? "compras";
}

/** Compras (y gestor de proyectos / admin) mientras el proyecto está en marcha, también durante la cotización. */
export async function canEditPurchasing(u: CurrentUser, p: Pick<Project, "status">) {
  if (!["in_progress", "paused", "in_production"].includes(p.status)) return false;
  return isAdmin(u) || isGlobalDecider(u) || u.departmentKeys.includes(await purchasingDeptKey());
}

async function guard(u: CurrentUser, projectId: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw new PurchasingError("Proyecto no encontrado");
  if (!(await canEditPurchasing(u, p))) throw new AuthzError("Solo Compras puede gestionar los componentes y proveedores de este proyecto");
  return p;
}

async function componentGuard(u: CurrentUser, componentId: number) {
  const [c] = await db.select().from(projectComponents).where(eq(projectComponents.id, componentId));
  if (!c) throw new PurchasingError("Componente no encontrado");
  const p = await guard(u, c.projectId);
  return { c, p };
}

// ─── Lectura ──────────────────────────────────────────────────────────────

export type ComponentQuoteView = {
  id: number;
  slot: number;
  supplierId: number;
  supplierName: string;
  supplierEmails: string[];
  status: string;
  price: string | null;
  notes: string | null;
  requestedAt: string | null;
  receivedAt: string | null;
};
export type ComponentView = {
  id: number;
  component: string;
  description: string | null;
  quotes: ComponentQuoteView[];
  chosenQuoteId: number | null;
  choiceComment: string | null;
  chosenAt: string | null;
  chosenBy: string | null;
};

export async function listComponents(projectId: string): Promise<ComponentView[]> {
  const comps = await db
    .select({ c: projectComponents, chosenBy: users.name })
    .from(projectComponents)
    .leftJoin(users, eq(users.id, projectComponents.chosenBy))
    .where(eq(projectComponents.projectId, projectId))
    .orderBy(asc(projectComponents.sort), asc(projectComponents.id));
  if (!comps.length) return [];
  const quotes = await db
    .select({ q: componentQuotes, name: suppliers.name, emails: suppliers.emails })
    .from(componentQuotes)
    .innerJoin(suppliers, eq(suppliers.id, componentQuotes.supplierId))
    .where(
      inArray(
        componentQuotes.componentId,
        comps.map((x) => x.c.id),
      ),
    )
    .orderBy(asc(componentQuotes.slot));
  return comps.map(({ c, chosenBy }) => ({
    id: c.id,
    component: c.component,
    description: c.description,
    chosenQuoteId: c.chosenQuoteId,
    choiceComment: c.choiceComment,
    chosenAt: c.chosenAt?.toISOString() ?? null,
    chosenBy,
    quotes: quotes
      .filter((x) => x.q.componentId === c.id)
      .map(({ q, name, emails }) => ({
        id: q.id,
        slot: q.slot,
        supplierId: q.supplierId,
        supplierName: name,
        supplierEmails: emails,
        status: q.status,
        price: q.price,
        notes: q.notes,
        requestedAt: q.requestedAt?.toISOString() ?? null,
        receivedAt: q.receivedAt?.toISOString() ?? null,
      })),
  }));
}

// ─── Componentes ──────────────────────────────────────────────────────────

const componentInput = z.object({
  component: z.enum(COMPONENT_KEYS),
  description: z.string().trim().max(300).optional().nullable(),
});

export async function addComponent(u: CurrentUser, projectId: string, raw: unknown) {
  await guard(u, projectId);
  const i = componentInput.parse(raw);
  const [{ n }] = (await db.select({ n: sql<number>`coalesce(max(${projectComponents.sort}), 0)::int` }).from(projectComponents).where(eq(projectComponents.projectId, projectId))) as [{ n: number }];
  const [row] = await db
    .insert(projectComponents)
    .values({ projectId, component: i.component, description: i.description || null, sort: n + 1 })
    .returning({ id: projectComponents.id });
  await logActivity({ projectId, actorId: u.id, action: "purchasing.component_added", entity: "component", entityId: String(row!.id), diff: { component: componentLabel({ component: i.component, description: i.description }) } });
  return row!.id;
}

export async function updateComponent(u: CurrentUser, componentId: number, description: string | null) {
  await componentGuard(u, componentId);
  const d = z.string().trim().max(300).optional().nullable().parse(description);
  await db.update(projectComponents).set({ description: d || null }).where(eq(projectComponents.id, componentId));
}

export async function deleteComponent(u: CurrentUser, componentId: number) {
  const { c } = await componentGuard(u, componentId);
  await db.delete(projectComponents).where(eq(projectComponents.id, componentId));
  await logActivity({ projectId: c.projectId, actorId: u.id, action: "purchasing.component_removed", entity: "component", entityId: String(c.id), diff: { component: componentLabel(c) } });
}

// ─── Proveedores y cotizaciones ───────────────────────────────────────────

const supplierInput = z.object({
  componentId: z.number().int().positive(),
  slot: z.number().int().min(1).max(MAX_SUPPLIERS),
  supplierId: z.number().int().positive().nullable().optional(),
  newSupplier: z
    .object({ name: z.string().trim().min(1, "Nombre del proveedor obligatorio").max(200), email: z.union([z.literal(""), z.string().trim().email("Email no válido")]).optional() })
    .nullable()
    .optional(),
});

/** Asigna (o cambia, o quita) el proveedor de una de las 3 posiciones de un componente. */
export async function setComponentSupplier(u: CurrentUser, raw: unknown) {
  const i = supplierInput.parse(raw);
  const { c } = await componentGuard(u, i.componentId);
  const [existing] = await db.select().from(componentQuotes).where(and(eq(componentQuotes.componentId, c.id), eq(componentQuotes.slot, i.slot)));
  if (!i.supplierId && !i.newSupplier?.name) {
    // Quitar el proveedor de esa posición
    if (existing) {
      await db.delete(componentQuotes).where(eq(componentQuotes.id, existing.id));
      if (c.chosenQuoteId === existing.id) await db.update(projectComponents).set({ chosenQuoteId: null, choiceComment: null, chosenAt: null, chosenBy: null }).where(eq(projectComponents.id, c.id));
    }
    return;
  }
  const supplierId = i.supplierId ?? (await resolveSupplier(db, { name: i.newSupplier!.name, email: i.newSupplier!.email || undefined }));
  const [dup] = await db.select({ id: componentQuotes.id }).from(componentQuotes).where(and(eq(componentQuotes.componentId, c.id), eq(componentQuotes.supplierId, supplierId)));
  if (dup && dup.id !== existing?.id) throw new PurchasingError("Ese proveedor ya está en este componente");
  if (existing) {
    if (existing.supplierId === supplierId) return;
    // Otro proveedor: la cotización vuelve a «Sin pedir»
    await db.update(componentQuotes).set({ supplierId, status: "pending", price: null, notes: null, requestedAt: null, receivedAt: null }).where(eq(componentQuotes.id, existing.id));
    if (c.chosenQuoteId === existing.id) await db.update(projectComponents).set({ chosenQuoteId: null, choiceComment: null, chosenAt: null, chosenBy: null }).where(eq(projectComponents.id, c.id));
  } else {
    await db.insert(componentQuotes).values({ componentId: c.id, slot: i.slot, supplierId });
  }
}

const quoteInput = z.object({
  quoteId: z.number().int().positive(),
  price: z.union([z.literal(""), z.string().trim().regex(/^\d+([.,]\d{1,4})?$/, "Precio no válido")]),
  notes: z.string().trim().max(1000).optional().nullable(),
});

/** Registra a mano el precio de un proveedor para un componente. */
export async function registerComponentQuote(u: CurrentUser, raw: unknown) {
  const q = quoteInput.parse(raw);
  const [row] = await db.select({ q: componentQuotes, supplier: suppliers.name }).from(componentQuotes).innerJoin(suppliers, eq(suppliers.id, componentQuotes.supplierId)).where(eq(componentQuotes.id, q.quoteId));
  if (!row) throw new PurchasingError("Cotización no encontrada");
  const { c } = await componentGuard(u, row.q.componentId);
  const price = q.price ? q.price.replace(",", ".") : null;
  const received = !!(price || q.notes);
  await db
    .update(componentQuotes)
    .set({ price, notes: q.notes || null, status: received ? "received" : row.q.status, receivedAt: received ? new Date() : row.q.receivedAt })
    .where(eq(componentQuotes.id, q.quoteId));
  await logActivity({ projectId: c.projectId, actorId: u.id, action: "purchasing.quote_registered", entity: "component", entityId: String(c.id), diff: { component: componentLabel(c), supplier: row.supplier, price: price ? Number(price) : null, notes: q.notes || null } });
}

/** Elige el proveedor de un componente (o quita la elección), con un comentario opcional del porqué. */
export async function chooseComponentQuote(u: CurrentUser, componentId: number, quoteId: number | null, comment?: string | null) {
  const { c } = await componentGuard(u, componentId);
  const why = z.string().trim().max(2000).optional().nullable().parse(comment) || null;
  if (quoteId == null) {
    await db.update(projectComponents).set({ chosenQuoteId: null, choiceComment: null, chosenAt: null, chosenBy: null }).where(eq(projectComponents.id, c.id));
    await logActivity({ projectId: c.projectId, actorId: u.id, action: "purchasing.supplier_unchosen", entity: "component", entityId: String(c.id), diff: { component: componentLabel(c) } });
    return;
  }
  const [q] = await db
    .select({ id: componentQuotes.id, supplier: suppliers.name, price: componentQuotes.price })
    .from(componentQuotes)
    .innerJoin(suppliers, eq(suppliers.id, componentQuotes.supplierId))
    .where(and(eq(componentQuotes.id, quoteId), eq(componentQuotes.componentId, c.id)));
  if (!q) throw new PurchasingError("Ese proveedor no está en este componente");
  await db.update(projectComponents).set({ chosenQuoteId: q.id, choiceComment: why, chosenAt: new Date(), chosenBy: u.id }).where(eq(projectComponents.id, c.id));
  await logActivity({
    projectId: c.projectId,
    actorId: u.id,
    action: "purchasing.supplier_chosen",
    entity: "component",
    entityId: String(c.id),
    diff: { component: componentLabel(c), supplier: q.supplier, price: q.price ? Number(q.price) : null, comment: why },
  });
}

// ─── Petición de cotización por email ─────────────────────────────────────

const QUOTE_INTRO = "desde Laboratorios NatuAromatic (NATU) estamos desarrollando un nuevo producto y necesitamos cotización de los siguientes componentes. ¿Nos podéis enviar precio unitario, cantidad mínima y plazo de entrega?";

type SupplierGroup = { supplier: typeof suppliers.$inferSelect; items: { component: string; description: string | null }[] };

async function groupsFor(projectId: string, supplierId: number | null, componentId: number | null) {
  const rows = await db
    .select({ c: projectComponents, q: componentQuotes, s: suppliers })
    .from(componentQuotes)
    .innerJoin(projectComponents, eq(projectComponents.id, componentQuotes.componentId))
    .innerJoin(suppliers, eq(suppliers.id, componentQuotes.supplierId))
    .where(eq(projectComponents.projectId, projectId))
    .orderBy(asc(projectComponents.sort), asc(componentQuotes.slot));
  const groups = new Map<number, SupplierGroup & { quoteIds: number[] }>();
  for (const r of rows) {
    if (supplierId != null && r.s.id !== supplierId) continue;
    if (componentId != null && r.c.id !== componentId) continue;
    // Sin proveedor concreto, no se vuelve a pedir a quien ya ha respondido
    if (supplierId == null && r.q.status === "received") continue;
    const g = groups.get(r.s.id) ?? { supplier: r.s, items: [], quoteIds: [] };
    g.items.push({ component: r.c.component, description: r.c.description });
    g.quoteIds.push(r.q.id);
    groups.set(r.s.id, g);
  }
  return [...groups.values()];
}

/** Emails de petición de cotización (uno por proveedor), para vista previa o envío. */
export async function componentQuoteEmails(u: CurrentUser, projectId: string, supplierId: number | null, componentId: number | null, message: string): Promise<(RepEmail & { quoteIds: number[] })[]> {
  const p = await guard(u, projectId);
  const groups = await groupsFor(projectId, supplierId, componentId);
  const mailbox = await inboxMailbox();
  const compras = await departmentRecipients([await purchasingDeptKey()]);
  const b = p.brief;
  return groups.map((g) => {
    // La respuesta va primero a Alexia (la lee, anota los precios y avisa a Compras)
    const alexia = quoteReplyAddress(mailbox, projectId, g.supplier.id, "project");
    const rows: [string, string][] = [["Referencia NATU", p.code ?? "—"]];
    rows.push(["Proyecto", p.name]);
    rows.push(["Componentes", g.items.map((x) => `• ${componentLabel(x)}`).join("\n")]);
    if (b.capacityMl) rows.push(["Capacidad", `${b.capacityMl} ml`]);
    if (b.firstOrderUnits) rows.push(["Unidades primer pedido (aprox.)", b.firstOrderUnits.toLocaleString("es-ES")]);
    if (b.annualUnits) rows.push(["Unidades estimadas al año", b.annualUnits.toLocaleString("es-ES")]);
    rows.push(["Contacto en NATU", `${u.name} · ${u.email}`]);
    return {
      key: `supplier.${g.supplier.id}`,
      audience: "supplier" as const,
      label: g.supplier.name,
      supplierId: g.supplier.id,
      quoteIds: g.quoteIds,
      to: uniqEmails(g.supplier.emails),
      replyTo: uniqEmails([alexia, u.email, ...compras]),
      subject: `Solicitud de cotización · ${g.items.map((x) => COMPONENT_LABEL[x.component] ?? x.component).join(", ")} · ${p.code}`.slice(0, 250),
      html: renderEmail({
        title: "Solicitud de cotización",
        intro: `Hola${g.supplier.contactName ? ` ${g.supplier.contactName}` : ""}, ${QUOTE_INTRO}`,
        message: message.trim() ? { label: `Mensaje de ${u.name}`, body: message.trim() } : null,
        extraRows: rows,
        ctaPath: null,
        subtitle: "Laboratories · Compras",
        footer: "Laboratorios NatuAromatic S.L. · Responde a este correo para enviar la cotización a nuestro equipo de Compras.",
      }),
    };
  });
}

export async function requestComponentQuotes(u: CurrentUser, projectId: string, supplierId: number | null, componentId: number | null, message: string) {
  const emails = await componentQuoteEmails(u, projectId, supplierId, componentId, message);
  const sent: string[] = [];
  for (const e of emails) {
    if (!e.to.length) continue;
    await queueNotification({ event: "purchasing.quote_requested", projectId, recipients: e.to, replyTo: e.replyTo, subject: e.subject, html: e.html });
    await db
      .update(componentQuotes)
      .set({ status: "requested", requestedAt: new Date() })
      .where(and(inArray(componentQuotes.id, e.quoteIds), sql`${componentQuotes.status} <> 'received'`));
    sent.push(e.label);
  }
  if (sent.length) await logActivity({ projectId, actorId: u.id, action: "purchasing.quote_requested", entity: "project", entityId: projectId, diff: { suppliers: sent } });
  return { sent, withoutEmail: emails.filter((e) => !e.to.length).map((e) => e.label) };
}

/** Componentes que un proveedor tiene en un proyecto (para leer su respuesta). */
export async function supplierQuotesInProject(projectId: string, supplierId: number) {
  return db
    .select({ q: componentQuotes, c: projectComponents })
    .from(componentQuotes)
    .innerJoin(projectComponents, eq(projectComponents.id, componentQuotes.componentId))
    .where(and(eq(projectComponents.projectId, projectId), eq(componentQuotes.supplierId, supplierId)))
    .orderBy(asc(projectComponents.sort));
}
