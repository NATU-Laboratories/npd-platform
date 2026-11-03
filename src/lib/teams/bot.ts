import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assistantChats, users } from "@/db/schema";
import { askAssistant, assistantEnabled, type ChatTurn } from "@/lib/server/assistant";
import { cancelAction, confirmAction, latestPendingTeams, markNoticesRead, unreadNotices } from "@/lib/server/assistant-actions";
import { isActive, loadUser } from "@/lib/server/authz";
import { logError } from "@/lib/server/errors";
import { absolutizeLinks, appId, conversationApi, rememberConversation, teamsConfigured, tenantId } from "./connector";
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

export { teamsConfigured };

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

const connector = <T,>(a: Activity, path: string, init: { method?: string; json?: unknown } = {}) => conversationApi<T>(a.serviceUrl!, a.conversation!.id, path, init);

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
  "¡Hola! Soy **Alexia** 🌿, la asistente de proyectos de NATU. Pregúntame cómo va cualquier proyecto o reposición, qué tienes pendiente o cómo se hace algo en la plataforma: yo me encargo de rebuscar. También puedo enviar avisos y comentarios por ti, siempre después de que me lo confirmes.\n\nEscribe **reiniciar** para empezar de cero.";
const YES = /^\s*(s[ií]|s[ií],? (env[ií]alo|hazlo|confirmo|adelante)|vale|ok|okay|confirmo|confirmar|adelante|dale|hazlo|env[ií]alo|perfecto)\s*[.!]*\s*$/i;
const NO = /^\s*(no|no,? gracias|cancela|cancelar|cancélalo|d[eé]jalo|mejor no)\s*[.!]*\s*$/i;

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
    await rememberConversation(u.id, { conversationId: convId, serviceUrl: a.serviceUrl!, botId: a.recipient!.id }).catch(() => {});
    const [row0] = await db.select().from(assistantChats).where(eq(assistantChats.conversationId, convId));
    const saveTurns = async (extra: ChatTurn[]) => {
      const base: ChatTurn[] = row0 && row0.userId === u.id ? row0.messages : [];
      const messages = [...base, ...extra].slice(-30);
      await db
        .insert(assistantChats)
        .values({ conversationId: convId, userId: u.id, messages })
        .onConflictDoUpdate({ target: assistantChats.conversationId, set: { userId: u.id, messages, updatedAt: new Date() } });
    };

    // ¿Responde «sí» / «no» a una acción que Alexia le ha preparado?
    const pending = YES.test(text) || NO.test(text) ? await latestPendingTeams(u.id, convId) : null;
    if (pending) {
      const res = YES.test(text) ? await confirmAction(u, pending.id) : await cancelAction(u, pending.id);
      await saveTurns([
        { role: "user", content: text },
        { role: "assistant", content: res.message },
      ]);
      await reply(a, res.message);
      return;
    }
    if (RESET.test(text)) {
      await db.delete(assistantChats).where(eq(assistantChats.conversationId, convId));
      await reply(a, "Hecho, borrón y cuenta nueva. ¿En qué te ayudo?");
      return;
    }
    if (!assistantEnabled()) {
      await reply(a, "El asistente no está configurado todavía.");
      return;
    }
    await connector(a, "/activities", { method: "POST", json: { type: "typing", from: a.recipient } }).catch(() => {});

    // Si cambia la persona (no debería en un chat personal), no se reutiliza el historial
    const history: ChatTurn[] = row0 && row0.userId === u.id ? row0.messages : [];
    const turns: ChatTurn[] = [...history, { role: "user", content: text }];
    let answer: string;
    try {
      const res = await askAssistant(u, turns, { channel: "teams", conversationId: convId });
      answer = res.text;
      const act = res.actions.at(-1);
      if (act) answer += `\n\n---\n**${act.title}**\n${act.lines.map(([k, v]) => `- **${k}:** ${v}`).join("\n")}\n\nResponde **sí** para hacerlo o **no** para cancelarlo.`;
    } catch (err) {
      await logError("teams", err, { userId: u.id });
      await reply(a, "Ahora mismo no puedo responder. Inténtalo de nuevo en unos minutos.");
      return;
    }
    // Avisos que aún no ha visto (p. ej. llegaron antes de hablar por primera vez con Alexia)
    const notices = await unreadNotices(u.id);
    if (notices.length) {
      answer = `${notices.map((n) => `📬 **${n.title}**${n.link ? ` · [abrir](${n.link})` : ""}\n\n«${n.body}»`).join("\n\n")}\n\n---\n${answer}`;
      await markNoticesRead(u.id, notices.map((n) => n.id));
    }
    await saveTurns([
      { role: "user", content: text },
      { role: "assistant", content: answer },
    ]);
    await reply(a, answer);
  } catch (err) {
    await logError("teams", err, { activityType: a.type });
  }
}
