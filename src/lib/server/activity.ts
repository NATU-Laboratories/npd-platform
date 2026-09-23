import "server-only";
import { db, type DbOrTx } from "@/db";
import { activityLog } from "@/db/schema";

export type ActivityInput = {
  projectId?: string | null;
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | number | null;
  diff?: Record<string, unknown> | null;
};

/** Toda acción que modifica datos queda en activity_log (§10 Auditoría). */
export async function logActivity(input: ActivityInput, tx: DbOrTx = db) {
  await tx.insert(activityLog).values({
    projectId: input.projectId ?? null,
    actorId: input.actorId ?? null,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId != null ? String(input.entityId) : null,
    diff: input.diff ?? null,
  });
}

export { jsonDiff } from "@/lib/diff";
