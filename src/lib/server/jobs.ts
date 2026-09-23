import "server-only";
import { after } from "next/server";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { jobs } from "@/db/schema";
import { logError } from "./errors";

/**
 * Cola simple con reintentos (§10 Resiliencia). Los trabajos se intentan
 * justo después de responder (after) y, si fallan, el cron los reintenta con
 * backoff exponencial.
 */

export type JobKind = "email.send" | "sharepoint.provision";

const handlers: Record<JobKind, (payload: Record<string, unknown>) => Promise<void>> = {
  "email.send": async (p) => (await import("./notifications")).deliverNotification(Number(p.notificationId)),
  "sharepoint.provision": async (p) => (await import("./provisioning")).provisionProjectFolder(String(p.projectId)),
};

export async function enqueueJob(kind: JobKind, payload: Record<string, unknown>, tx: DbOrTx = db) {
  const [row] = await tx.insert(jobs).values({ kind, payload }).returning({ id: jobs.id });
  return row!.id;
}

/** Programa la ejecución inmediata (tras la respuesta) de los trabajos indicados. */
export function kickJobs(ids: number[]) {
  if (!ids.length) return;
  try {
    after(() => runJobs({ ids }));
  } catch {
    // fuera de un contexto de petición (scripts): ejecutar ya
    void runJobs({ ids });
  }
}

function backoffMinutes(attempts: number) {
  return Math.min(2 ** attempts, 240);
}

export async function runJobs(opts: { ids?: number[]; limit?: number } = {}) {
  const limit = opts.limit ?? 25;
  // Recuperar trabajos colgados en "running" (función abortada)
  await db
    .update(jobs)
    .set({ status: "pending" })
    .where(and(eq(jobs.status, "running"), lt(jobs.updatedAt, sql`now() - interval '10 minutes'`)));

  const idFilter = opts.ids?.length ? sql`and id in ${opts.ids}` : sql``;
  const claimed = await db.execute<{ id: number; kind: JobKind; payload: Record<string, unknown>; attempts: number; max_attempts: number }>(sql`
    update jobs set status = 'running', attempts = attempts + 1, updated_at = now()
    where id in (
      select id from jobs
      where status = 'pending' and run_at <= now() ${idFilter}
      order by run_at
      for update skip locked
      limit ${limit}
    )
    returning id, kind, payload, attempts, max_attempts`);

  const results = { done: 0, failed: 0, retried: 0 };
  for (const job of claimed.rows) {
    try {
      const handler = handlers[job.kind];
      if (!handler) throw new Error(`Tipo de trabajo desconocido: ${job.kind}`);
      await handler(job.payload);
      await db.update(jobs).set({ status: "done", lastError: null, updatedAt: new Date() }).where(eq(jobs.id, job.id));
      results.done++;
    } catch (err) {
      const final = job.attempts >= job.max_attempts;
      await db
        .update(jobs)
        .set({
          status: final ? "failed" : "pending",
          lastError: err instanceof Error ? err.message : String(err),
          runAt: sql`now() + (${backoffMinutes(job.attempts)} || ' minutes')::interval`,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));
      await logError(`job:${job.kind}`, err, { jobId: job.id, attempt: job.attempts, final, payload: job.payload });
      if (final) results.failed++;
      else results.retried++;
    }
  }
  return { claimed: claimed.rows.length, ...results };
}

/** Reintento manual desde el backoffice. */
export async function retryJobs(ids: number[]) {
  await db.update(jobs).set({ status: "pending", runAt: new Date(), updatedAt: new Date() }).where(inArray(jobs.id, ids));
  kickJobs(ids);
}
