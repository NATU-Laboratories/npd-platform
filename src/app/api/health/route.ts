import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { devLoginEnabled, devLoginRequiresPassword } from "@/auth";
import { db } from "@/db";
import { graphConfigured } from "@/lib/graph/client";
import { mailDriver } from "@/lib/graph/mail";
import { storageDriver } from "@/lib/graph/storage";
import { assistantEnabled } from "@/lib/server/assistant";
import { teamsConfigured } from "@/lib/teams/bot";

export const dynamic = "force-dynamic";

/** Diagnóstico de configuración (sin revelar secretos). */
export async function GET() {
  let database: { ok: boolean; tables?: number; error?: string };
  try {
    const { rows } = await db.execute<{ n: number }>(sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`);
    database = { ok: true, tables: rows[0]?.n };
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    const msg = cause instanceof Error ? cause.message : String(cause);
    database = { ok: false, error: msg.replace(/postgres(ql)?:\/\/[^\s]+/g, "<url>").slice(0, 300) };
  }
  const env = (k: string) => Boolean(process.env[k]);
  const entra = await entraDiagnostics();
  const body = {
    database,
    auth: {
      AUTH_SECRET: env("AUTH_SECRET"),
      APP_URL: process.env.APP_URL ?? null,
      ADMIN_EMAILS: env("ADMIN_EMAILS"),
      microsoftEntraId: env("AUTH_MICROSOFT_ENTRA_ID_ID") && env("AUTH_MICROSOFT_ENTRA_ID_SECRET"),
      entra,
      provisionalLogin: devLoginEnabled,
      provisionalLoginPassword: devLoginRequiresPassword,
    },
    graph: graphConfigured(),
    storage: storageDriver(),
    mail: mailDriver(),
    cron: env("CRON_SECRET"),
    assistant: assistantEnabled(),
    teamsBot: teamsConfigured(),
  };
  return NextResponse.json(body, { status: database.ok && body.auth.AUTH_SECRET ? 200 : 500 });
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Comprueba la configuración del login con Microsoft sin mostrar ningún valor secreto. */
async function entraDiagnostics() {
  const id = (process.env.AUTH_MICROSOFT_ENTRA_ID_ID ?? "").trim();
  const secret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET ?? "";
  const issuer = (process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER ?? "").trim();
  const tenant = (process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID ?? "").trim();
  const problems: string[] = [];
  if (!id) problems.push("Falta AUTH_MICROSOFT_ENTRA_ID_ID");
  else if (!GUID.test(id)) problems.push("AUTH_MICROSOFT_ENTRA_ID_ID no tiene formato de Id. de aplicación (cliente)");
  if (!secret) problems.push("Falta AUTH_MICROSOFT_ENTRA_ID_SECRET");
  else if (GUID.test(secret.trim())) problems.push("AUTH_MICROSOFT_ENTRA_ID_SECRET parece el «Id. de secreto»: hay que poner el «Valor»");
  else if (secret !== secret.trim()) problems.push("AUTH_MICROSOFT_ENTRA_ID_SECRET tiene espacios al principio o al final");
  if (!tenant) problems.push("Falta AUTH_MICROSOFT_ENTRA_ID_TENANT_ID");
  else if (!GUID.test(tenant)) problems.push("AUTH_MICROSOFT_ENTRA_ID_TENANT_ID no tiene formato de Id. de directorio (inquilino)");
  else if (tenant === id) problems.push("AUTH_MICROSOFT_ENTRA_ID_TENANT_ID es igual al Id. de aplicación: debe ser el Id. de directorio (inquilino)");
  let discovery: "ok" | string = "sin comprobar";
  const m = issuer.match(/^https:\/\/login\.microsoftonline\.com\/([^/]+)\/v2\.0\/?$/);
  if (!issuer) problems.push("Falta AUTH_MICROSOFT_ENTRA_ID_ISSUER");
  else if (!m) problems.push("AUTH_MICROSOFT_ENTRA_ID_ISSUER debe ser https://login.microsoftonline.com/<Id. de inquilino>/v2.0/");
  else {
    if (tenant && m[1] !== tenant) problems.push("El inquilino del ISSUER no coincide con AUTH_MICROSOFT_ENTRA_ID_TENANT_ID");
    try {
      const r = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      discovery = r.ok ? "ok" : `Microsoft responde ${r.status} (revisa el Id. de inquilino del ISSUER)`;
      if (!r.ok) problems.push(discovery);
    } catch (err) {
      discovery = `No se pudo contactar con Microsoft: ${err instanceof Error ? err.message : String(err)}`;
      problems.push(discovery);
    }
  }
  return { ok: problems.length === 0, discovery, problems, redirectUri: `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/api/auth/callback/microsoft-entra-id` };
}
