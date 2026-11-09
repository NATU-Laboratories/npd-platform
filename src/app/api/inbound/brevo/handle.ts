import { after } from "next/server";
import { logError } from "@/lib/server/errors";
import { handleSupplierReply } from "@/lib/server/supplier-replies";

/** Procesa el cuerpo del webhook de entrada de Brevo (responde al momento; Alexia trabaja después). */
export async function receive(req: Request) {
  const body = (await req.json().catch(() => null)) as { items?: unknown[] } | Record<string, unknown> | null;
  if (!body) return new Response("Bad request", { status: 400 });
  const items = (Array.isArray((body as { items?: unknown[] }).items) ? (body as { items: unknown[] }).items : [body]) as Record<string, unknown>[];
  console.info(`[inbound] recibido: ${items.length} email(s); campos: ${Object.keys(items[0] ?? {}).join(", ")}`);
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
