import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { logError } from "@/lib/server/errors";
import { handleSupplierReply } from "@/lib/server/supplier-replies";

export const maxDuration = 60;

const tokenOk = (given: string | null) => {
  const secret = process.env.INBOUND_SECRET ?? "";
  if (!secret || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Emails recibidos (webhook de entrada de Brevo): respuestas de proveedores a las peticiones de
 * presupuesto. Responde al momento y Alexia los procesa después (lectura, anotación y aviso).
 * Protegido con ?token=INBOUND_SECRET; además cada dirección de respuesta va firmada.
 */
export async function POST(req: Request) {
  if (!tokenOk(new URL(req.url).searchParams.get("token"))) return new Response("Unauthorized", { status: 401 });
  const body = (await req.json().catch(() => null)) as { items?: unknown[] } | Record<string, unknown> | null;
  if (!body) return new Response("Bad request", { status: 400 });
  const items = (Array.isArray((body as { items?: unknown[] }).items) ? (body as { items: unknown[] }).items : [body]) as Record<string, unknown>[];
  after(async () => {
    for (const item of items.slice(0, 20)) {
      try {
        const res = await handleSupplierReply(item);
        console.info(`[inbound] ${res}`);
      } catch (err) {
        await logError("inbound:brevo", err);
      }
    }
  });
  return Response.json({ ok: true, received: items.length });
}
