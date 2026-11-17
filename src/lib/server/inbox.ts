import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { graphFetch, GraphError } from "@/lib/graph/client";
import { logError } from "./errors";
import { graphClientState, inboxMailbox } from "./reply-address";
import { handleSupplierReply, type InboundEmail } from "./supplier-replies";

/**
 * Buzón de la plataforma (projects@natuaromatic.com) leído por Microsoft Graph: las respuestas de
 * proveedores a las peticiones de presupuesto llegan a él y Alexia las procesa.
 * - Suscripción de Graph a los mensajes nuevos de la bandeja de entrada → /api/inbound/graph.
 *   Caduca como mucho a los 7 días: el cron diario la renueva.
 * - Barrido diario de los últimos días por si se perdió algún aviso (cada mensaje se procesa una vez).
 * Permisos de aplicación: Mail.Send y Mail.Read, limitados a este buzón.
 */

const STATE_KEY = "inbox_subscription";
/** Duración pedida (Graph admite hasta 10 080 min para mensajes) y margen para renovarla. */
const LIFETIME_MS = 6 * 24 * 3600_000;
const RENEW_BEFORE_MS = 3 * 24 * 3600_000;

export { inboxMailbox };

export type InboxState = { id: string | null; mailbox: string | null; expiresAt: string | null; error: string | null; checkedAt: string };

export async function inboxState(): Promise<InboxState | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, STATE_KEY));
  return (row?.value as InboxState | undefined) ?? null;
}

async function saveState(s: InboxState) {
  await db.insert(settings).values({ key: STATE_KEY, value: s }).onConflictDoUpdate({ target: settings.key, set: { value: s } });
}

const appUrl = () => (process.env.APP_URL ?? "").trim().replace(/\/$/, "");

function describe(err: unknown) {
  if (err instanceof GraphError) {
    const body = String(err.details.body ?? "");
    const msg = /"message"\s*:\s*"([^"]+)"/.exec(body)?.[1];
    if (err.status === 403 || /Access is denied|AccessDenied|ErrorAccessDenied/i.test(body))
      return `Graph ${err.status}: sin permiso para leer el buzón (falta Mail.Read o la política de acceso no incluye este buzón)`;
    return `Graph ${err.status}${msg ? `: ${msg}` : ""}`.slice(0, 300);
  }
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

/** Crea o renueva la suscripción a los mensajes nuevos. `force` la vuelve a crear desde cero. */
export async function ensureInboxSubscription({ force = false } = {}): Promise<InboxState> {
  const mailbox = await inboxMailbox();
  const prev = await inboxState();
  const now = Date.now();
  const base = { mailbox, checkedAt: new Date(now).toISOString() };
  if (!mailbox) {
    const s = { ...base, id: null, expiresAt: null, error: null };
    await saveState(s);
    return s;
  }
  if (!appUrl().startsWith("https://")) {
    const s = { ...base, id: prev?.id ?? null, expiresAt: prev?.expiresAt ?? null, error: "Falta APP_URL (https://…): Microsoft necesita la dirección pública para avisar de los emails nuevos" };
    await saveState(s);
    return s;
  }
  const expiresAt = new Date(now + LIFETIME_MS).toISOString();
  const sameMailbox = prev?.id && prev.mailbox === mailbox;
  if (sameMailbox && !force && !prev.error && prev.expiresAt && new Date(prev.expiresAt).getTime() - now > RENEW_BEFORE_MS) return prev;
  try {
    // Renovar la existente; si ya no existe (caducó o se borró), crear otra
    if (sameMailbox && !force) {
      try {
        await graphFetch(`/subscriptions/${prev.id}`, { method: "PATCH", json: { expirationDateTime: expiresAt } });
        const s = { ...base, id: prev.id, expiresAt, error: null };
        await saveState(s);
        return s;
      } catch (err) {
        if (!(err instanceof GraphError && err.status === 404)) throw err;
      }
    }
    if (prev?.id) await graphFetch(`/subscriptions/${prev.id}`, { method: "DELETE" }).catch(() => undefined);
    const sub = await graphFetch<{ id: string; expirationDateTime: string }>("/subscriptions", {
      method: "POST",
      json: {
        changeType: "created",
        notificationUrl: `${appUrl()}/api/inbound/graph`,
        resource: `/users/${mailbox}/mailFolders('inbox')/messages`,
        expirationDateTime: expiresAt,
        clientState: graphClientState(),
      },
    });
    const s = { ...base, id: sub.id, expiresAt: sub.expirationDateTime, error: null };
    await saveState(s);
    return s;
  } catch (err) {
    await logError("inbox:subscription", err, { mailbox });
    const s = { ...base, id: prev?.id ?? null, expiresAt: prev?.expiresAt ?? null, error: describe(err) };
    await saveState(s);
    return s;
  }
}

type GraphAddress = { emailAddress?: { address?: string; name?: string } };
type GraphMessage = {
  id: string;
  internetMessageId?: string;
  subject?: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
};
type GraphAttachment = { "@odata.type"?: string; name?: string; contentType?: string; size?: number; contentBytes?: string };

const addr = (a?: GraphAddress) => (a?.emailAddress?.address ?? "").toLowerCase();
const userPath = (mailbox: string) => `/users/${encodeURIComponent(mailbox)}`;

/** Lee un mensaje del buzón y se lo pasa a Alexia. */
export async function processInboxMessage(mailbox: string, messageId: string): Promise<string> {
  const base = `${userPath(mailbox)}/messages/${encodeURIComponent(messageId)}`;
  const m = await graphFetch<GraphMessage>(`${base}?$select=id,internetMessageId,subject,from,toRecipients,ccRecipients,body,hasAttachments`, {
    headers: { Prefer: 'outlook.body-content-type="text"' },
  });
  const from = addr(m.from);
  // Los emails que envía la propia plataforma no son respuestas de proveedores
  if (from === mailbox) return "ignorado: enviado por la plataforma";
  let attachments: InboundEmail["attachments"] = [];
  if (m.hasAttachments) {
    const list = await graphFetch<{ value: GraphAttachment[] }>(`${base}/attachments`).catch((err) => (logError("inbox:attachments", err, { messageId }), { value: [] }));
    attachments = list.value
      .filter((a) => a["@odata.type"] === "#microsoft.graph.fileAttachment")
      .map((a) => ({
        name: a.name || "adjunto",
        type: a.contentType ?? "",
        load: async () => (a.contentBytes && (a.size ?? 0) <= 10 * 1024 * 1024 ? Buffer.from(a.contentBytes, "base64") : null),
      }));
  }
  return handleSupplierReply({
    id: m.internetMessageId || m.id,
    from,
    recipients: [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])].map(addr).filter(Boolean),
    subject: m.subject ?? "",
    body: (m.body?.content ?? "").trim(),
    attachments,
  });
}

/** Barrido de la bandeja de entrada de los últimos días (red de seguridad de la suscripción). */
export async function sweepInbox(days = 3): Promise<{ checked: number; results: string[] }> {
  const mailbox = await inboxMailbox();
  if (!mailbox) return { checked: 0, results: [] };
  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString();
  const list = await graphFetch<{ value: { id: string }[] }>(
    `${userPath(mailbox)}/mailFolders('inbox')/messages?$filter=receivedDateTime ge ${since}&$select=id&$orderby=receivedDateTime desc&$top=50`,
  );
  const results: string[] = [];
  for (const { id } of list.value) {
    try {
      results.push(await processInboxMessage(mailbox, id));
    } catch (err) {
      await logError("inbox:sweep", err, { messageId: id });
    }
  }
  return { checked: list.value.length, results: results.filter((r) => !r.startsWith("ignorado")) };
}

/** Tarea diaria: renovar la suscripción y barrer la bandeja de entrada. */
export async function syncInbox() {
  if (!(await inboxMailbox())) return { enabled: false };
  const sub = await ensureInboxSubscription();
  const sweep = await sweepInbox().catch(async (err) => (await logError("inbox:sweep", err), { checked: 0, results: [], error: describe(err) }));
  return { enabled: true, subscription: { expiresAt: sub.expiresAt, error: sub.error }, sweep };
}
