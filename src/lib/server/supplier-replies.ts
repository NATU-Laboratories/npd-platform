import "server-only";
import OpenAI from "openai";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { componentQuotes, files as projectFiles, projectComponents, projects, replenishmentFiles, replenishmentItems, replenishments, suppliers, users } from "@/db/schema";
import { COMPONENT_LABEL, componentLabel, fmtSupplierPrice } from "@/lib/purchasing/components";
import { putFile } from "@/lib/graph/storage";
import { ELEMENT_LABEL } from "@/lib/replenishment/config";
import { normalizeText } from "@/lib/sheet/field-input";
import { logActivity } from "./activity";
import { assistantEnabled, MODEL } from "./assistant";
import { logError } from "./errors";
import { findReplyTarget } from "./reply-address";
import { repFolder } from "./replenishments";
import { renderEmail } from "./email-template";
import { queueNotification } from "./notifications";
import { uploadTargetFolder } from "./provisioning";
import { purchasingDeptKey, supplierQuotesInProject } from "./purchasing";
import { getSettings } from "./settings";
import { alert, claim, department, merge } from "./watchdog";

/**
 * Respuesta de un proveedor a una petición de presupuesto (llega al buzón de la plataforma y se
 * lee por Microsoft Graph, ver inbox.ts). Alexia lee el email y sus PDF, anota el presupuesto en
 * la reposición y avisa a Compras (y a quien abrió la reposición) con el texto del proveedor.
 */

/** Un email recibido, ya normalizado. */
export type InboundEmail = {
  /** Identificador único (Message-ID) para no procesarlo dos veces. */
  id: string;
  from: string;
  /** Destinatarios (Para y CC). */
  recipients: string[];
  subject: string;
  /** Texto del email. */
  body: string;
  attachments: { name: string; type: string; load: () => Promise<Buffer | null> }[];
};

type Extracted = { isQuote: boolean; items: { element: string; price: number | null; notes: string }[]; leadTime: string | null; summary: string };

/** Alexia lee la respuesta (texto y PDF) y saca el presupuesto de cada elemento. */
async function extract(text: string, pdfs: { name: string; data: Buffer }[], elements: string[]): Promise<Extracted | null> {
  if (!assistantEnabled()) return null;
  const client = new OpenAI();
  const res = await client.responses.create({
    model: MODEL,
    reasoning: { effort: "low" },
    store: false,
    instructions:
      "Eres Alexia, asistente de Compras de NATU. Te paso la respuesta de un proveedor a una petición de presupuesto (texto del email y, si hay, PDF adjuntos). Extrae el presupuesto de cada elemento pedido. El precio va en euros por millar (1.000 unidades), que es como suelen cotizar los proveedores de envases, componentes y etiquetas: si lo dan por unidad, multiplícalo por 1.000; si lo dan por otra cantidad o por lote, conviértelo a €/millar y explícalo en las notas. Si hay precios por tramos de cantidad, usa el del tramo más cercano a la cantidad pedida y pon los demás en las notas. En «notes» pon condiciones relevantes (cantidad mínima, portes, validez…). Si el proveedor no da precio (pregunta algo, dice que lo enviará más tarde…), isQuote=false y explica en «summary» qué dice. No inventes datos.",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: `Elementos pedidos a este proveedor: ${elements.join(", ")}.\n\nEmail del proveedor:\n${text.slice(0, 12000)}` },
          ...pdfs.map((p) => ({ type: "input_file" as const, filename: p.name, file_data: `data:application/pdf;base64,${p.data.toString("base64")}` })),
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "presupuesto",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["isQuote", "items", "leadTime", "summary"],
          properties: {
            isQuote: { type: "boolean" },
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["element", "price", "notes"],
                properties: { element: { type: "string" }, price: { type: ["number", "null"] }, notes: { type: "string" } },
              },
            },
            leadTime: { type: ["string", "null"] },
            summary: { type: "string" },
          },
        },
      },
    },
  });
  try {
    return JSON.parse(res.output_text) as Extracted;
  } catch {
    return null;
  }
}

const fmtPrice = fmtSupplierPrice;

type Target = { kind: "replenishment" | "project"; id: string; supplierId: number };

/** Único proveedor cuyo email coincide con el remitente (o null si no hay o hay varios). */
function bySender<T extends { emails: string[] }>(rows: T[], from: string) {
  const matches = rows.filter((r) => r.emails.some((e) => e.trim().toLowerCase() === from));
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Reposición o proyecto y proveedor a los que responde el email: por la dirección de respuesta
 * firmada o, si el proveedor contestó a la dirección normal del buzón, por el código en el asunto
 * (REP-2026-0001, PL001…) y su email entre los de un proveedor al que se le pidió cotización.
 */
async function targetOf(email: InboundEmail): Promise<Target | null> {
  const signed = findReplyTarget(email.recipients.join(" "));
  if (signed) return signed;
  if (!email.from) return null;
  const repCode = /\bREP-\d{4}-\d{3,}\b/i.exec(email.subject)?.[0]?.toUpperCase();
  if (repCode) {
    const rows = await db
      .selectDistinct({ id: replenishments.id, supplierId: suppliers.id, emails: suppliers.emails })
      .from(replenishments)
      .innerJoin(replenishmentItems, eq(replenishmentItems.replenishmentId, replenishments.id))
      .innerJoin(suppliers, eq(suppliers.id, replenishmentItems.supplierId))
      .where(eq(replenishments.code, repCode));
    const m = bySender(rows, email.from);
    if (m) return { kind: "replenishment", id: m.id, supplierId: m.supplierId };
  }
  const projectCode = /\b(?:PL|MDF|MDD)\d{3,}\b/i.exec(email.subject)?.[0]?.toUpperCase();
  if (projectCode) {
    const rows = await db
      .selectDistinct({ id: projects.id, supplierId: suppliers.id, emails: suppliers.emails })
      .from(projects)
      .innerJoin(projectComponents, eq(projectComponents.projectId, projects.id))
      .innerJoin(componentQuotes, eq(componentQuotes.componentId, projectComponents.id))
      .innerJoin(suppliers, eq(suppliers.id, componentQuotes.supplierId))
      .where(eq(projects.code, projectCode));
    const m = bySender(rows, email.from);
    if (m) return { kind: "project", id: m.id, supplierId: m.supplierId };
  }
  return null;
}

/** Procesa un email recibido. Devuelve qué ha hecho (para el registro). */
export async function handleSupplierReply(email: InboundEmail): Promise<string> {
  // El buzón recibe también otros correos: los que no son respuestas a una petición de presupuesto se ignoran
  const target = await targetOf(email);
  if (!target) return "ignorado: no es una respuesta a una petición de presupuesto";
  if (email.id && !(await claim("inbound_email", email.id.slice(0, 200), "processed"))) return "ignorado: ya procesado";
  return target.kind === "project" ? handleProjectReply(email, target) : handleRepReply(email, target);
}

async function handleRepReply(email: InboundEmail, target: Target): Promise<string> {
  const [rep] = await db
    .select({ r: replenishments, requesterEmail: users.email, requesterId: users.id })
    .from(replenishments)
    .innerJoin(users, eq(users.id, replenishments.requesterId))
    .where(eq(replenishments.id, target.id));
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, target.supplierId));
  if (!rep || !supplier) {
    await logError("inbound:ignored", new Error("Respuesta de presupuesto de una reposición o proveedor que ya no existe"), target);
    return "ignorado: reposición o proveedor inexistente";
  }
  const items = await db
    .select()
    .from(replenishmentItems)
    .where(and(eq(replenishmentItems.replenishmentId, rep.r.id), eq(replenishmentItems.supplierId, supplier.id)));

  const { from, subject, body } = email;
  const atts = email.attachments;
  // Adjuntos (PDF e imágenes): se guardan en la reposición como «Cotización del proveedor»; los PDF los lee Alexia
  const pdfs: { name: string; data: Buffer }[] = [];
  const saved: string[] = [];
  const files: { storageItemId: string; name: string; mime: string | null }[] = [];
  for (const a of atts.filter((x) => /pdf|image\//i.test(x.type) || /\.(pdf|png|jpe?g)$/i.test(x.name)).slice(0, 5)) {
    const data = await a.load().catch(() => null);
    if (!data) continue;
    const isPdf = /pdf/i.test(a.type) || /\.pdf$/i.test(a.name);
    if (isPdf && pdfs.length < 3) pdfs.push({ name: a.name, data });
    try {
      const { folderId } = await repFolder(rep.r.id);
      const name = `${supplier.name} · ${a.name}`.slice(0, 180);
      const stored = await putFile(folderId, name, data, a.type || (isPdf ? "application/pdf" : "application/octet-stream"));
      await db.insert(replenishmentFiles).values({ replenishmentId: rep.r.id, storageItemId: stored.id, name: stored.name, mime: stored.mime, size: stored.size, tag: "cotizacion", round: rep.r.round, uploadedBy: rep.requesterId });
      saved.push(a.name);
      files.push({ storageItemId: stored.id, name: a.name, mime: stored.mime ?? null });
    } catch (err) {
      await logError("alexia:supplier-reply:file", err, { rep: rep.r.code, file: a.name });
    }
  }

  const labelOf = (i: (typeof items)[number]) => `${ELEMENT_LABEL[i.element] ?? i.element}${i.description ? ` (${i.description})` : ""}`;
  let extracted: Extracted | null = null;
  try {
    extracted = await extract(body, pdfs, items.map(labelOf));
  } catch (err) {
    await logError("alexia:supplier-reply:extract", err, { rep: rep.r.code });
  }

  // Anotar el presupuesto en cada elemento (por nombre; si solo hay uno, directamente)
  const registered: string[] = [];
  if (extracted?.isQuote) {
    for (const it of items) {
      const match =
        items.length === 1 && extracted.items.length === 1
          ? extracted.items[0]
          : extracted.items.find((x) => normalizeText(labelOf(it)).includes(normalizeText(x.element)) || normalizeText(x.element).includes(normalizeText(ELEMENT_LABEL[it.element] ?? it.element)));
      if (!match || match.price == null) continue;
      const notes = [match.notes, extracted.leadTime ? `Plazo: ${extracted.leadTime}` : null, "Anotado por Alexia desde el email del proveedor."].filter(Boolean).join(" · ").slice(0, 1000);
      await db
        .update(replenishmentItems)
        .set({ quotePrice: String(Math.round(match.price * 10000) / 10000), quoteNotes: notes, quoteStatus: "received", quoteReceivedAt: new Date() })
        .where(eq(replenishmentItems.id, it.id));
      await logActivity({ actorId: null, action: "replenishment.quote_received", entity: "replenishment", entityId: rep.r.id, diff: { element: ELEMENT_LABEL[it.element], price: match.price, via: "Alexia (email del proveedor)" } });
      registered.push(`${labelOf(it)}: ${fmtPrice(match.price)}`);
    }
  }

  // La respuesta queda en el historial de la reposición
  await logActivity({
    actorId: null,
    action: "replenishment.supplier_reply",
    entity: "replenishment",
    entityId: rep.r.id,
    diff: { supplier: supplier.name, from, subject, body: body.slice(0, 20000), attachments: atts.map((a) => a.name), saved, registered, summary: extracted?.summary ?? null },
  });

  // Reenvío de la respuesta completa (texto y adjuntos) a Compras, a quien abrió la reposición y a
  // quien se haya indicado en Backoffice → Configuración. Pueden contestar directamente al proveedor.
  const compras = await department("compras");
  const { supplier_reply_cc } = await getSettings();
  const to = merge(compras, { userIds: [rep.requesterId], emails: [rep.requesterEmail, ...(supplier_reply_cc ?? [])] });
  const what = registered.length
    ? `Lo he anotado en la reposición: ${registered.join("; ")}${extracted?.leadTime ? `. Plazo: ${extracted.leadTime}` : ""}. Revísalo por si hay que corregir algo.`
    : extracted && !extracted.isQuote
      ? `No trae precio: ${extracted.summary}`
      : "No he podido sacar el precio con seguridad: revisa su respuesta y regístralo en la reposición.";
  const title = `${supplier.name} ha respondido a la recotización de ${rep.r.code}`;
  await queueNotification({
    event: "alexia.supplier_reply",
    replenishmentId: rep.r.id,
    recipients: to.emails,
    // «Responder» contesta directamente al proveedor
    replyTo: from ? [from] : [],
    subject: `${subject && /^(re|rv|fw|fwd):/i.test(subject) ? subject : `RE: ${subject || "Solicitud de recotización"}`} · ${supplier.name} · ${rep.r.code}`,
    html: renderEmail({
      title,
      intro: `Reenvío de Alexia: esta es la respuesta del proveedor. ${what}`,
      message: { label: `Respuesta de ${supplier.name}${from ? ` (${from})` : ""}`, body: body.slice(0, 20000) || "(sin texto)" },
      extraRows: [
        ["Reposición", `${rep.r.code} · ${rep.r.title}`],
        ...(atts.length ? ([["Adjuntos", `${atts.map((x) => x.name).join(", ")}${files.length < atts.length ? " (algunos no se han podido adjuntar: revísalos en el correo del proveedor)" : ""}`]] as [string, string][]) : []),
      ],
      ctaPath: `/reposiciones/${rep.r.id}`,
      ctaLabel: "Abrir la reposición",
    }),
    attachments: files,
  });
  // Y el aviso en el chat de Alexia / Teams (sin repetir el email)
  await alert(to, { event: "alexia.supplier_reply", replenishmentId: rep.r.id, link: `/reposiciones/${rep.r.id}`, title, body: what, noEmail: true });
  return registered.length ? `presupuesto anotado (${registered.length})` : "respuesta registrada sin precio";
}

/** Respuesta de un proveedor a la petición de cotización de los componentes de un proyecto. */
async function handleProjectReply(email: InboundEmail, target: Target): Promise<string> {
  const [p] = await db.select().from(projects).where(eq(projects.id, target.id));
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, target.supplierId));
  const quotes = p && supplier ? await supplierQuotesInProject(p.id, supplier.id) : [];
  if (!p || !supplier || !quotes.length) {
    await logError("inbound:ignored", new Error("Respuesta de cotización de un proyecto, proveedor o componente que ya no existe"), target);
    return "ignorado: proyecto, proveedor o componentes inexistentes";
  }
  const { from, subject, body } = email;
  const atts = email.attachments;

  // Adjuntos (PDF e imágenes) → archivos del proyecto (Compras); los PDF los lee Alexia
  const pdfs: { name: string; data: Buffer }[] = [];
  const files: { storageItemId: string; name: string; mime: string | null }[] = [];
  for (const a of atts.filter((x) => /pdf|image\//i.test(x.type) || /\.(pdf|png|jpe?g)$/i.test(x.name)).slice(0, 5)) {
    const data = await a.load().catch(() => null);
    if (!data) continue;
    const isPdf = /pdf/i.test(a.type) || /\.pdf$/i.test(a.name);
    if (isPdf && pdfs.length < 3) pdfs.push({ name: a.name, data });
    try {
      const folderId = await uploadTargetFolder(p.id, p.phase);
      const name = `${supplier.name} · ${a.name}`.slice(0, 180);
      const stored = await putFile(folderId, name, data, a.type || (isPdf ? "application/pdf" : "application/octet-stream"));
      await db.insert(projectFiles).values({ projectId: p.id, sharepointItemId: stored.id, name: stored.name, mime: stored.mime, size: stored.size, tag: "compras", phase: p.phase, uploadedBy: p.requesterId });
      files.push({ storageItemId: stored.id, name: a.name, mime: stored.mime ?? null });
    } catch (err) {
      await logError("alexia:supplier-reply:file", err, { project: p.code, file: a.name });
    }
  }

  const labelOf = (x: (typeof quotes)[number]) => componentLabel(x.c);
  let extracted: Extracted | null = null;
  try {
    extracted = await extract(body, pdfs, quotes.map(labelOf));
  } catch (err) {
    await logError("alexia:supplier-reply:extract", err, { project: p.code });
  }

  const registered: string[] = [];
  if (extracted?.isQuote) {
    for (const x of quotes) {
      const match =
        quotes.length === 1 && extracted.items.length === 1
          ? extracted.items[0]
          : extracted.items.find((e) => normalizeText(labelOf(x)).includes(normalizeText(e.element)) || normalizeText(e.element).includes(normalizeText(COMPONENT_LABEL[x.c.component] ?? x.c.component)));
      if (!match || match.price == null) continue;
      const notes = [match.notes, extracted.leadTime ? `Plazo: ${extracted.leadTime}` : null, "Anotado por Alexia desde el email del proveedor."].filter(Boolean).join(" · ").slice(0, 1000);
      await db
        .update(componentQuotes)
        .set({ price: String(Math.round(match.price * 10000) / 10000), notes, status: "received", receivedAt: new Date() })
        .where(eq(componentQuotes.id, x.q.id));
      registered.push(`${labelOf(x)}: ${fmtPrice(match.price)}`);
    }
  }

  await logActivity({
    projectId: p.id,
    actorId: null,
    action: "purchasing.supplier_reply",
    entity: "project",
    entityId: p.id,
    diff: { supplier: supplier.name, from, subject, body: body.slice(0, 20000), attachments: atts.map((a) => a.name), registered, summary: extracted?.summary ?? null },
  });

  // Reenvío a Compras (y a quien se haya indicado en Backoffice → Configuración)
  const compras = await department(await purchasingDeptKey());
  const { supplier_reply_cc } = await getSettings();
  const to = merge(compras, { userIds: [], emails: supplier_reply_cc ?? [] });
  const what = registered.length
    ? `Lo he anotado en el desglose de componentes: ${registered.join("; ")}${extracted?.leadTime ? `. Plazo: ${extracted.leadTime}` : ""}. Revísalo por si hay que corregir algo.`
    : extracted && !extracted.isQuote
      ? `No trae precio: ${extracted.summary}`
      : "No he podido sacar el precio con seguridad: revisa su respuesta y regístralo en el desglose de componentes.";
  const title = `${supplier.name} ha respondido a la cotización de componentes de ${p.code}`;
  await queueNotification({
    event: "alexia.supplier_reply",
    projectId: p.id,
    recipients: to.emails,
    replyTo: from ? [from] : [],
    subject: (() => {
      const base = subject && /^(re|rv|fw|fwd):/i.test(subject) ? subject : `RE: ${subject || "Solicitud de cotización"}`;
      return `${base} · ${supplier.name}${p.code && !base.includes(p.code) ? ` · ${p.code}` : ""}`;
    })(),
    html: renderEmail({
      title,
      intro: `Reenvío de Alexia: esta es la respuesta del proveedor. ${what}`,
      message: { label: `Respuesta de ${supplier.name}${from ? ` (${from})` : ""}`, body: body.slice(0, 20000) || "(sin texto)" },
      extraRows: [
        ["Proyecto", `${p.code} · ${p.name}`],
        ["Componentes pedidos", quotes.map(labelOf).join(", ")],
        ...(atts.length ? ([["Adjuntos", `${atts.map((x) => x.name).join(", ")}${files.length < atts.length ? " (algunos no se han podido adjuntar: revísalos en el correo del proveedor)" : ""}`]] as [string, string][]) : []),
      ],
      ctaPath: `/proyectos/${p.id}#componentes`,
      ctaLabel: "Abrir el desglose de componentes",
    }),
    attachments: files,
  });
  await alert(to, { event: "alexia.supplier_reply", projectId: p.id, link: `/proyectos/${p.id}#componentes`, title, body: what, noEmail: true });
  return registered.length ? `cotización anotada (${registered.length})` : "respuesta registrada sin precio";
}
