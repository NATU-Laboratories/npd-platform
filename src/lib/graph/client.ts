import "server-only";

/**
 * Cliente mínimo de Microsoft Graph con credenciales de aplicación
 * (client credentials). El token nunca sale del servidor (§10 Seguridad).
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {
  constructor(
    message: string,
    public status: number,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "GraphError";
  }
}

export function graphConfigured() {
  return !!(process.env.GRAPH_TENANT_ID && process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET);
}

let cached: { token: string; exp: number } | null = null;

async function getToken() {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const tenant = process.env.GRAPH_TENANT_ID;
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GRAPH_CLIENT_ID!,
      client_secret: process.env.GRAPH_CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new GraphError(`No se pudo obtener token de Graph (${res.status})`, res.status, { body: await res.text() });
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, exp: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

export async function graphFetch<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown; retries?: number } = {},
): Promise<T> {
  const { json, retries = 2, ...rest } = init;
  const url = path.startsWith("http") ? path : `${GRAPH}${path}`;
  for (let attempt = 0; ; attempt++) {
    const token = await getToken();
    const res = await fetch(url, {
      ...rest,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(rest.headers ?? {}),
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      cache: "no-store",
    });
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const wait = Number(res.headers.get("Retry-After") ?? 2 ** attempt) * 1000;
      await new Promise((r) => setTimeout(r, Math.min(wait, 10_000)));
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new GraphError(`Graph ${rest.method ?? "GET"} ${path} → ${res.status}`, res.status, {
        url,
        body: text.slice(0, 2000),
      });
    }
    if (res.status === 202 || res.status === 204) return undefined as T;
    const ct = res.headers.get("content-type") ?? "";
    return (ct.includes("json") ? await res.json() : await res.text()) as T;
  }
}
