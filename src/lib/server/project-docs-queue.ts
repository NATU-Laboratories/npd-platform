import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { kickJobs } from "./jobs";

/**
 * Programa la regeneración de la ficha (Word) y el historial del proyecto en su carpeta.
 * Si ya hay una pendiente para ese proyecto no se añade otra (recogerá los últimos cambios).
 */
export async function scheduleProjectDocs(projectId: string) {
  try {
    const [pending] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.kind, "sharepoint.docs"), eq(jobs.status, "pending"), sql`${jobs.payload}->>'projectId' = ${projectId}`))
      .limit(1);
    if (pending) return;
    const [row] = await db.insert(jobs).values({ kind: "sharepoint.docs", payload: { projectId } }).returning({ id: jobs.id });
    kickJobs([row!.id]);
  } catch {
    // Nunca debe impedir la acción que lo provoca
  }
}
