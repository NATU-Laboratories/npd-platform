import { after } from "next/server";
import { logError } from "@/lib/server/errors";
import { inboxMailbox, processInboxMessage } from "@/lib/server/inbox";
import { clientStateOk } from "@/lib/server/reply-address";

export const maxDuration = 60;

type Notification = { subscriptionId?: string; clientState?: string; resourceData?: { id?: string } };

/**
 * Avisos de Microsoft Graph: un email nuevo en la bandeja de entrada del buzón de la plataforma.
 * Al crear la suscripción, Graph comprueba la dirección con ?validationToken=… (hay que devolverlo
 * tal cual). Cada aviso lleva el clientState secreto de nuestra suscripción.
 */
export async function POST(req: Request) {
  const validationToken = new URL(req.url).searchParams.get("validationToken");
  if (validationToken) return new Response(validationToken, { status: 200, headers: { "content-type": "text/plain" } });

  const body = (await req.json().catch(() => null)) as { value?: Notification[] } | null;
  const valid = (body?.value ?? []).filter((n) => clientStateOk(n.clientState) && n.resourceData?.id);
  if (!body?.value?.length) return new Response("Bad request", { status: 400 });
  if (!valid.length) {
    await logError("inbound:unauthorized", new Error("Aviso de Graph con un clientState que no coincide"), { count: body.value.length });
    return new Response("Unauthorized", { status: 401 });
  }
  // Graph espera respuesta en pocos segundos: Alexia trabaja después
  after(async () => {
    const mailbox = await inboxMailbox();
    if (!mailbox) return;
    for (const n of valid.slice(0, 20)) {
      try {
        console.info(`[inbound] ${await processInboxMessage(mailbox, n.resourceData!.id!)}`);
      } catch (err) {
        await logError("inbound:graph", err, { messageId: n.resourceData!.id });
      }
    }
  });
  return new Response(null, { status: 202 });
}
