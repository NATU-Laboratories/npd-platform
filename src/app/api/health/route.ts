import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { devLoginEnabled, devLoginRequiresPassword } from "@/auth";
import { db } from "@/db";
import { graphConfigured } from "@/lib/graph/client";
import { mailDriver } from "@/lib/graph/mail";
import { storageDriver } from "@/lib/graph/storage";

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
  const body = {
    database,
    auth: {
      AUTH_SECRET: env("AUTH_SECRET"),
      APP_URL: process.env.APP_URL ?? null,
      ADMIN_EMAILS: env("ADMIN_EMAILS"),
      microsoftEntraId: env("AUTH_MICROSOFT_ENTRA_ID_ID") && env("AUTH_MICROSOFT_ENTRA_ID_SECRET"),
      provisionalLogin: devLoginEnabled,
      provisionalLoginPassword: devLoginRequiresPassword,
    },
    graph: graphConfigured(),
    storage: storageDriver(),
    mail: mailDriver(),
    cron: env("CRON_SECRET"),
  };
  return NextResponse.json(body, { status: database.ok && body.auth.AUTH_SECRET ? 200 : 500 });
}
