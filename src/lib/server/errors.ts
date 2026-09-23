import "server-only";
import { db } from "@/db";
import { errorLog } from "@/db/schema";

/** Registra un error en error_log sin lanzar nunca (§8 Logs de errores). */
export async function logError(
  source: string,
  err: unknown,
  context?: Record<string, unknown>,
  level: "error" | "warning" = "error",
) {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`[${source}]`, e.message, context ?? "");
  try {
    await db.insert(errorLog).values({
      source,
      level,
      message: e.message.slice(0, 2000),
      stack: e.stack?.slice(0, 8000),
      context: { ...(context ?? {}), ...((e as { details?: object }).details ?? {}) },
    });
  } catch (dbErr) {
    console.error("[logError] no se pudo guardar el error", dbErr);
  }
}
