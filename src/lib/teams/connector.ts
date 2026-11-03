import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { teamsConversations } from "@/db/schema";
import { appUrl } from "@/lib/utils";

/** Conexión con Bot Framework (token de la app del bot y envío de actividades). */

export const appId = () => process.env.TEAMS_APP_ID ?? "";
export const tenantId = () => process.env.TEAMS_TENANT_ID || process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID || "";

export function teamsConfigured() {
  return !!(appId() && process.env.TEAMS_APP_PASSWORD && tenantId());
}

let tokenCache: { token: string; exp: number } | null = null;
export async function botToken() {
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

/** Llamada a la API de conversaciones de Bot Framework. */
export async function conversationApi<T>(serviceUrl: string, conversationId: string, path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
  const base = serviceUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/v3/conversations/${encodeURIComponent(conversationId)}${path}`, {
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

/** Guarda la conversación personal de la persona para poder escribirle después. */
export async function rememberConversation(userId: string, ref: { conversationId: string; serviceUrl: string; botId: string }) {
  await db
    .insert(teamsConversations)
    .values({ userId, ...ref })
    .onConflictDoUpdate({ target: teamsConversations.userId, set: { ...ref, updatedAt: new Date() } });
}

/**
 * Mensaje por iniciativa de Alexia en el chat personal de Teams de una persona
 * (solo si ya ha hablado alguna vez con el bot). Devuelve si se ha enviado.
 */
export async function sendProactive(userId: string, text: string) {
  if (!teamsConfigured()) return false;
  const [ref] = await db.select().from(teamsConversations).where(eq(teamsConversations.userId, userId));
  if (!ref) return false;
  await conversationApi(ref.serviceUrl, ref.conversationId, "/activities", {
    method: "POST",
    json: { type: "message", text: absolutizeLinks(text), textFormat: "markdown", from: { id: ref.botId } },
  });
  return true;
}
