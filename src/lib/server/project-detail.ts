import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  activityLog,
  brands,
  clients,
  comments,
  departments,
  files,
  gates,
  infoRequests,
  projectDepartments,
  projects,
  templateTasks,
  users,
  workflowTemplates,
} from "@/db/schema";

const requester = alias(users, "requester");
const accountManager = alias(users, "account_manager");

export async function loadProjectDetail(id: string) {
  const [row] = await db
    .select({
      p: projects,
      clientName: clients.name,
      clientCountry: clients.country,
      brandName: brands.name,
      requesterName: requester.name,
      accountManagerName: accountManager.name,
      templateName: workflowTemplates.name,
    })
    .from(projects)
    .innerJoin(requester, eq(requester.id, projects.requesterId))
    .leftJoin(accountManager, eq(accountManager.id, projects.accountManagerId))
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(brands, eq(brands.id, projects.brandId))
    .leftJoin(workflowTemplates, eq(workflowTemplates.id, projects.templateId))
    .where(eq(projects.id, id));
  if (!row) return null;

  const [deptRows, gateRows, activity, commentRows, fileRows, irRows] = await Promise.all([
    db
      .select({ id: departments.id, name: departments.name, color: departments.color })
      .from(projectDepartments)
      .innerJoin(departments, eq(departments.id, projectDepartments.departmentId))
      .where(eq(projectDepartments.projectId, id))
      .orderBy(asc(departments.sort)),
    db.select({ g: gates, by: users.name }).from(gates).leftJoin(users, eq(users.id, gates.decidedBy)).where(eq(gates.projectId, id)).orderBy(asc(gates.gate)),
    db
      .select({ a: activityLog, actor: users.name })
      .from(activityLog)
      .leftJoin(users, eq(users.id, activityLog.actorId))
      .where(eq(activityLog.projectId, id))
      .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
      .limit(500),
    db
      .select({ c: comments, author: users.name })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(eq(comments.projectId, id))
      .orderBy(asc(comments.createdAt)),
    db
      .select({ f: files, by: users.name })
      .from(files)
      .innerJoin(users, eq(users.id, files.uploadedBy))
      .where(eq(files.projectId, id))
      .orderBy(asc(files.phase), asc(files.createdAt)),
    db
      .select({ ir: infoRequests, by: users.name })
      .from(infoRequests)
      .innerJoin(users, eq(users.id, infoRequests.requestedBy))
      .where(eq(infoRequests.projectId, id))
      .orderBy(desc(infoRequests.requestedAt)),
  ]);

  return { ...row, departments: deptRows, gates: gateRows, activity, comments: commentRows, files: fileRows, infoRequests: irRows };
}

/** Plantillas activas con sus departamentos (para el modal de G1). */
export async function templatesWithDepartments() {
  const tpls = await db.select().from(workflowTemplates).where(eq(workflowTemplates.isActive, true)).orderBy(asc(workflowTemplates.id));
  const ids = tpls.map((t) => t.id);
  const rows = ids.length
    ? await db.selectDistinct({ templateId: templateTasks.templateId, departmentId: templateTasks.departmentId }).from(templateTasks).where(inArray(templateTasks.templateId, ids))
    : [];
  return tpls.map((t) => ({
    id: t.id,
    name: t.name,
    appliesTo: t.appliesTo,
    departmentIds: rows.filter((r) => r.templateId === t.id).map((r) => r.departmentId),
  }));
}

/** Puntuación de encaje plantilla ↔ proyecto (tipo, subtipo, categoría). */
export function templateScore(
  t: { appliesTo: { types?: string[]; subtypes?: string[]; categories?: string[] } },
  p: { type: string | null; subtype: string | null; category: string | null },
) {
  const a = t.appliesTo;
  let s = 0;
  if (a.types?.length) s += p.type && a.types.includes(p.type) ? 4 : -10;
  if (a.subtypes?.length) s += p.subtype && a.subtypes.includes(p.subtype) ? 3 : -3;
  if (a.categories?.length) s += p.category && a.categories.includes(p.category) ? 2 : -5;
  return s;
}
