import "server-only";
import OpenAI from "openai";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { replenishmentFiles, replenishmentItems, replenishments, suppliers, users } from "@/db/schema";
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
import { getSettings } from "./settings";
import { alert, claim, department, merge } from "./watchdog";

/**
 * Respuesta de un proveedor a una petición de presupuesto (llega por el webhook de entrada
 * de Brevo). Alexia lee el email y sus PDF, anota el presupuesto en la reposición y avisa a
 * Compras (y a quien abrió la reposición) con el texto del proveedor.
 */

/** Un email recibido, tal como lo manda Brevo (los nombres de campo pueden variar). */
type InboundItem = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const pick = (o: InboundItem, ...keys: string[]) => keys.map((k) => o[k]).find((v) => v != null);

function addressOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return str((v as Record<string, unknown>).Address ?? (v as Record<string, unknown>).address ?? (v as Record<string, unknown>).Email);
  return "";
}

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Attachment = { name: string; type: string; token: string };

function attachmentsOf(item: InboundItem): Attachment[] {
  const list = pick(item, "Attachments", "attachments");
  if (!Array.isArray(list)) return [];
  return list.map((a: Record<string, unknown>) => ({
    name: str(a.Name ?? a.name) || "adjunto",
    type: str(a.ContentType ?? a.contentType),
    token: str(a.DownloadToken ?? a.downloadToken),
  }));
}

/** Descarga un adjunto del email recibido (API de Brevo). */
async function download(a: Attachment): Promise<Buffer | null> {
  if (!a.token || !process.env.BREVO_API_KEY) return null;
  const r = await fetch(`https://api.brevo.com/v3/inbound/attachments/${encodeURIComponent(a.token)}`, {
    headers: { "api-key": process.env.BREVO_API_KEY.trim() },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.length <= 10 * 1024 * 1024 ? buf : null;
}

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
      "Eres Alexia, asistente de Compras de NATU. Te paso la respuesta de un proveedor a una petición de presupuesto (texto del email y, si hay, PDF adjuntos). Extrae el presupuesto de cada elemento pedido. El precio es el unitario en euros por unidad (si dan precio por millar o por lote, conviértelo a €/ud y explícalo en las notas). En «notes» pon condiciones relevantes (cantidad mínima, portes, validez…). Si el proveedor no da precio (pregunta algo, dice que lo enviará más tarde…), isQuote=false y explica en «summary» qué dice. No inventes datos.",
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

const fmtPrice = (n: number) => `${n.toLocaleString("es-ES", { maximumFractionDigits: 4 })} €/ud`;

/** Procesa un email recibido. Devuelve qué ha hecho (para el registro). */
export async function handleSupplierReply(item: InboundItem): Promise<string> {
  const id = str(pick(item, "MessageId", "messageId", "Uuid", "uuid")) || JSON.stringify(pick(item, "Uuid")) || "";
  const recipients = JSON.stringify([pick(item, "To", "to"), pick(item, "Recipients", "recipients"), pick(item, "Cc", "cc"), pick(item, "Headers", "headers")]);
  // Primero en los destinatarios; si Brevo usa otros nombres de campo, en todo el email
  const target = findReplyTarget(recipients) ?? findReplyTarget(JSON.stringify(item));
  if (!target) {
    await logError("inbound:ignored", new Error("Email recibido sin una dirección de respuesta de presupuesto válida"), {
      keys: Object.keys(item).slice(0, 40),
      to: recipients.slice(0, 600),
      from: addressOf(pick(item, "From", "from")),
      subject: str(pick(item, "Subject", "subject")).slice(0, 200),
    });
    return "ignorado: no va a una dirección de respuesta de presupuesto válida";
  }
  if (id && !(await claim("inbound_email", id.slice(0, 200), "processed"))) return "ignorado: ya procesado";

  const [rep] = await db
    .select({ r: replenishments, requesterEmail: users.email, requesterId: users.id })
    .from(replenishments)
    .innerJoin(users, eq(users.id, replenishments.requesterId))
    .where(eq(replenishments.id, target.repId));
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, target.supplierId));
  if (!rep || !supplier) {
    await logError("inbound:ignored", new Error("Respuesta de presupuesto de una reposición o proveedor que ya no existe"), target);
    return "ignorado: reposición o proveedor inexistente";
  }
  const items = await db
    .select()
    .from(replenishmentItems)
    .where(and(eq(replenishmentItems.replenishmentId, rep.r.id), eq(replenishmentItems.supplierId, supplier.id)));

  const from = addressOf(pick(item, "From", "from"));
  const subject = str(pick(item, "Subject", "subject"));
  const body = str(pick(item, "ExtractedMarkdownMessage", "extractedMarkdownMessage")) || str(pick(item, "RawTextBody", "rawTextBody")) || stripHtml(str(pick(item, "RawHtmlBody", "rawHtmlBody")));
  const atts = attachmentsOf(item);
  // Adjuntos (PDF e imágenes): se guardan en la reposición como «Cotización del proveedor»; los PDF los lee Alexia
  const pdfs: { name: string; data: Buffer }[] = [];
  const saved: string[] = [];
  const files: { storageItemId: string; name: string; mime: string | null }[] = [];
  for (const a of atts.filter((x) => /pdf|image\//i.test(x.type) || /\.(pdf|png|jpe?g)$/i.test(x.name)).slice(0, 5)) {
    const data = await download(a).catch(() => null);
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
