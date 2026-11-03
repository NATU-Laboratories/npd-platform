import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assistantChats, users } from "@/db/schema";
import { askAssistant, assistantEnabled, type ChatTurn } from "@/lib/server/assistant";
import { isActive, loadUser } from "@/lib/server/authz";
import { logError } from "@/lib/server/errors";
import { appUrl } from "@/lib/utils";
import { verifyBotJwt, type Jwk } from "./jwt";

/**
 * Bot de Microsoft Teams del asistente (chat personal). Habla con Bot Framework
 * por REST: valida el token de cada mensaje entrante y responde con un token
 * de la app del bot. Cada persona ve solo lo que ve en la plataforma.
 */

export type Activity = {
  type: string;
  id?: string;
  channelId?: string;
  serviceUrl?: string;
  text?: string;
  from?: { id: string; name?: string; aadObjectId?: string };
  recipient?: { id: string; name?: string };
  conversation?: { id: string; conversationType?: string; tenantId?: string };
  channelData?: { tenant?: { id?: string } };
  membersAdded?: { id: string }[];
};

const BOT_ISSUER = "https://api.botframework.com";
const OPENID_URL = "https://login.botframework.com/v1/.well-known/openidconfiguration";

const appId = () => process.env.TEAMS_APP_ID ?? "";
const tenantId = () => process.env.TEAMS_TENANT_ID || process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID || "";

export function teamsConfigured() {
  return !!(appId() && process.env.TEAMS_APP_PASSWORD && tenantId());
}

let keyCache: { keys: Jwk[]; exp: number } | null = null;
async function botKeys(force = false): Promise<Jwk[]> {
  if (!force && keyCache && keyCache.exp > Date.now()) return keyCache.keys;
  const cfg = (await (await fetch(OPENID_URL, { cache: "no-store" })).json()) as { jwks_uri: string };
  const { keys } = (await (await fetch(cfg.jwks_uri, { cache: "no-store" })).json()) as { keys: Jwk[] };
  keyCache = { keys, exp: Date.now() + 12 * 3600_000 };
  return keys;
}

/** Comprueba que la petición viene de Bot Framework, para este bot y de nuestro tenant. */
export async function authenticate(authHeader: string | null, a: Activity) {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || !a.serviceUrl) return false;
  const opts = { issuer: BOT_ISSUER, audience: appId(), serviceUrl: a.serviceUrl };
  const usable = (keys: Jwk[]) => keys.filter((k) => !k.endorsements || (a.channelId && k.endorsements.includes(a.channelId)));
  let claims = verifyBotJwt(token, usable(await botKeys()), opts);
  if (!claims) claims = verifyBotJwt(token, usable(await botKeys(true)), opts); // rotación de claves
  if (!claims) return false;
  const tenant = a.channelData?.tenant?.id ?? a.conversation?.tenantId;
  return a.channelId === "msteams" && tenant === tenantId();
}

let tokenCache: { token: string; exp: number } | null = null;
async function botToken() {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const res = await fetch(`https://login.microsoftonline.com/${tenantId()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: appId(),
      client_secret: process.env.TEAMS_APP_PASSWORD ?? "",
      scope: "https://api.botframework.com/.default",
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`No se pudo obtener el token del bot de Teams (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, exp: Date.now() + json.expires_in * 1000 };
  return tokenCache.token;
}

async function connector<T>(a: Activity, path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const base = a.serviceUrl!.replace(/\/$/, "");
  const res = await fetch(`${base}/v3/conversations/${encodeURIComponent(a.conversation!.id)}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${await botToken()}`, ...(init.json ? { "Content-Type": "application/json" } : {}) },
    body: init.json ? JSON.stringify(init.json) : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Bot Framework ${init.method ?? "GET"} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/** Enlaces internos (/proyectos/…) → absolutos, para que se abran desde Teams. */
export function absolutizeLinks(text: string) {
  return text.replace(/\]\(\//g, `](${appUrl()}/`);
}

async function reply(a: Activity, text: string) {
  await connector(a, "/activities", {
    method: "POST",
    json: { type: "message", text: absolutizeLinks(text), textFormat: "markdown", replyToId: a.id, from: a.recipient, recipient: a.from },
  });
}

/** Usuario de la plataforma que escribe: por su ID de Entra o, si no, por su email corporativo. */
async function resolveUser(a: Activity) {
  const oid = a.from?.aadObjectId;
  if (oid) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.entraOid, oid));
    if (u) return loadUser(u.id);
  }
  const member = await connector<{ email?: string; userPrincipalName?: string }>(a, `/members/${encodeURIComponent(a.from!.id)}`);
  const email = (member.email || member.userPrincipalName || "").toLowerCase();
  if (!email) return null;
  const [u] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`);
  return u ? loadUser(u.id) : null;
}

const RESET = /^\s*(\/?reiniciar|\/?reset|nueva conversaci[oó]n|empezar de nuevo)\s*$/i;
const WELCOME =
  "¡Hola! Soy **NIA**, la asistente de la plataforma de proyectos de NATU. Pregúntame cómo va cualquier proyecto que puedas ver en la plataforma, qué tienes pendiente o cómo se hace algo.\n\nEscribe **reiniciar** para empezar una conversación nueva. Solo consulto, no hago cambios.";

/** Procesa un mensaje del chat personal (se ejecuta tras responder 200 a Teams). */
export async function handleActivity(a: Activity) {
  try {
    if (a.conversation?.conversationType && a.conversation.conversationType !== "personal") return;
    if (a.type === "conversationUpdate") {
      if (a.membersAdded?.some((m) => m.id === a.recipient?.id)) await reply(a, WELCOME);
      return;
    }
    if (a.type !== "message") return;
    const text = (a.text ?? "").replace(/<at>.*?<\/at>/g, "").trim().slice(0, 4000);
    if (!text) return;

    const u = await resolveUser(a);
    if (!u || !isActive(u)) {
      await reply(a, "No encuentro tu usuario activo en la plataforma NPD. Pide al administrador que te dé de alta con tu email corporativo.");
      return;
    }
    const convId = a.conversation!.id;
    if (RESET.test(text)) {
      await db.delete(assistantChats).where(eq(assistantChats.conversationId, convId));
      await reply(a, "Listo, empezamos de cero. ¿En qué te ayudo?");
      return;
    }
    if (!assistantEnabled()) {
      await reply(a, "El asistente no está configurado todavía.");
      return;
    }
    await connector(a, "/activities", { method: "POST", json: { type: "typing", from: a.recipient } }).catch(() => {});

    const [row] = await db.select().from(assistantChats).where(eq(assistantChats.conversationId, convId));
    // Si cambia la persona (no debería en un chat personal), no se reutiliza el historial
    const history: ChatTurn[] = row && row.userId === u.id ? row.messages : [];
    const turns: ChatTurn[] = [...history, { role: "user", content: text }];
    let answer: string;
    try {
      answer = await askAssistant(u, turns);
    } catch (err) {
      await logError("teams", err, { userId: u.id });
      await reply(a, "Ahora mismo no puedo responder. Inténtalo de nuevo en unos minutos.");
      return;
    }
    const messages = [...turns, { role: "assistant" as const, content: answer }].slice(-30);
    await db
      .insert(assistantChats)
      .values({ conversationId: convId, userId: u.id, messages })
      .onConflictDoUpdate({ target: assistantChats.conversationId, set: { userId: u.id, messages, updatedAt: new Date() } });
    await reply(a, answer);
  } catch (err) {
    await logError("teams", err, { activityType: a.type });
  }
}
