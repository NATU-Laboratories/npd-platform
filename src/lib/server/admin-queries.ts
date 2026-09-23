import "server-only";
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, projects, users } from "@/db/schema";

export type ActivityFilters = { q?: string; action?: string; actor?: string; from?: string; to?: string };

export function activityWhere(f: ActivityFilters) {
  const c: SQL[] = [];
  if (f.action) c.push(ilike(activityLog.action, `${f.action}%`));
  if (f.actor) c.push(eq(activityLog.actorId, f.actor));
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) c.push(gte(activityLog.createdAt, new Date(`${f.from}T00:00:00`)));
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) c.push(lte(activityLog.createdAt, new Date(`${f.to}T23:59:59`)));
  if (f.q) c.push(or(ilike(projects.code, `%${f.q}%`), ilike(activityLog.entityId, `%${f.q}%`), sql`${activityLog.diff}::text ilike ${`%${f.q}%`}`)!);
  return c.length ? and(...c) : undefined;
}

export function activityQuery(f: ActivityFilters, limit: number) {
  return db
    .select({ a: activityLog, actor: users.name, actorEmail: users.email, code: projects.code })
    .from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.actorId))
    .leftJoin(projects, eq(projects.id, activityLog.projectId))
    .where(activityWhere(f))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);
}
