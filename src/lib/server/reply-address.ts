import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mailDriver } from "@/lib/graph/mail";
import { getSettings } from "./settings";

/**
 * Dirección de respuesta de cada petición de presupuesto: identifica la reposición y el
 * proveedor y va firmada (nadie puede inventarse una para anotar presupuestos en otra
 * reposición). Usa el «plus addressing» de Exchange sobre el buzón de la plataforma:
 * projects+cot-…@natuaromatic.com llega al mismo buzón y Alexia lo lee por Graph.
 */
const secret = () => process.env.INBOUND_SECRET || process.env.AUTH_SECRET || "";

/** Buzón que lee Alexia: el remitente de la plataforma, solo si se envía por Graph. MAIL_INBOUND=off lo desactiva. */
export async function inboxMailbox(): Promise<string | null> {
  if (mailDriver() !== "graph" || process.env.MAIL_INBOUND === "off") return null;
  const { sender_mailbox } = await getSettings();
  return (sender_mailbox || process.env.MAIL_SENDER || "").trim().toLowerCase() || null;
}

const sign = (repId: string, supplierId: number) => createHmac("sha256", secret()).update(`${repId}:${supplierId}`).digest("hex").slice(0, 12);

/** `buzon@dominio` → `buzon+cot-<reposición>-<proveedor>-<firma>@dominio`. */
export function quoteReplyAddress(mailbox: string | null, repId: string, supplierId: number) {
  const m = /^([^@+\s]+)@([^@\s]+)$/.exec((mailbox ?? "").trim().toLowerCase());
  if (!m || !secret()) return null;
  return `${m[1]}+cot-${repId.replace(/-/g, "")}-${supplierId}-${sign(repId, supplierId)}@${m[2]}`;
}

/** Busca una dirección de respuesta válida en un texto (destinatarios del email recibido). */
export function findReplyTarget(text: string): { repId: string; supplierId: number } | null {
  const re = /cot-([0-9a-f]{32})-(\d+)-([0-9a-f]{12})@([a-z0-9.-]+)/gi;
  for (const m of text.matchAll(re)) {
    const hex = m[1]!.toLowerCase();
    const repId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const supplierId = Number(m[2]);
    const a = Buffer.from(sign(repId, supplierId));
    const b = Buffer.from(m[3]!.toLowerCase());
    if (a.length === b.length && timingSafeEqual(a, b)) return { repId, supplierId };
  }
  return null;
}

/** Valor `clientState` de la suscripción de Graph: prueba que el aviso viene de nuestra suscripción. */
export function graphClientState() {
  const s = secret();
  return s ? createHmac("sha256", s).update("graph-inbox-subscription").digest("hex").slice(0, 64) : "";
}

export function clientStateOk(given: string | null | undefined) {
  const expected = graphClientState();
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
