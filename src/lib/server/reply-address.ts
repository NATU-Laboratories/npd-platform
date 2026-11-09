import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Dirección de respuesta de cada petición de presupuesto: identifica la reposición y el
 * proveedor y va firmada (nadie puede inventarse una para anotar presupuestos en otra
 * reposición). Las respuestas llegan a Brevo (dominio INBOUND_DOMAIN) y de ahí a la plataforma.
 */
const secret = () => process.env.INBOUND_SECRET || process.env.AUTH_SECRET || "";
export const inboundDomain = () => (process.env.INBOUND_DOMAIN ?? "").trim().toLowerCase();
export const inboundEnabled = () => !!inboundDomain() && !!process.env.INBOUND_SECRET;

const sign = (repId: string, supplierId: number) => createHmac("sha256", secret()).update(`${repId}:${supplierId}`).digest("hex").slice(0, 12);

export function quoteReplyAddress(repId: string, supplierId: number) {
  if (!inboundEnabled()) return null;
  return `cot-${repId.replace(/-/g, "")}-${supplierId}-${sign(repId, supplierId)}@${inboundDomain()}`;
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
