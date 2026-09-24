import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { brands, clients, departments, projectDepartments, projects, users, type ProjectStatus } from "@/db/schema";
import { OPEN_STATUSES, STATUS_GROUPS } from "@/lib/labels";
import { hasRole, projectVisibility, type CurrentUser } from "./authz";

export type ProjectFilters = {
  q?: string;
  type?: string;
  brand?: string;
  category?: string;
  status?: string; // estado o grupo (g:solicitados…)
  phase?: string;
  requester?: string;
  department?: string;
  from?: string;
  to?: string;
  risk?: string;
  mine?: string;
  action?: string;
  sort?: string;
  dir?: string;
  page?: string;
};

const requester = alias(users, "requester");

/**
 * "Requieren mi acción": info pedida a mí, aprobaciones G1/G2 pendientes que me
 * tocan y cotizaciones pendientes de enviar de mis cuentas.
 */
function requiresMyAction(u: CurrentUser): SQL {
  const mine = or(eq(projects.requesterId, u.id), eq(projects.accountManagerId, u.id))!;
  const conds: SQL[] = [
    and(eq(projects.status, "info_requested"), mine)!,
    and(eq(projects.status, "in_progress"), eq(projects.phase, 1), eq(projects.accountManagerId, u.id))!,
  ];
  const typesFor = (gate: "G1" | "G2") => u.deciderFor.filter((d) => d.gate === gate).map((d) => d.projectType);
  const g1 = and(eq(projects.status, "submitted"), eq(projects.phase, 0))!;
  const g2 = and(eq(projects.status, "in_progress"), eq(projects.phase, 2))!;
  if (hasRole(u, "admin")) conds.push(g1, g2);
  else {
    if (typesFor("G1").length) conds.push(and(g1, inArray(projects.type, typesFor("G1")))!);
    if (typesFor("G2").length) conds.push(and(g2, inArray(projects.type, typesFor("G2")))!);
  }
  return or(...conds)!;
}

export function riskCondition(riskDays: number): SQL {
  return and(
    inArray(projects.status, OPEN_STATUSES),
    isNotNull(projects.neededBy),
    lte(projects.neededBy, sql`(current_date + ${riskDays}::int)`),
  )!;
}

export async function buildWhere(u: CurrentUser, f: ProjectFilters, riskDays: number, opts: { includeDrafts?: boolean } = {}) {
  const conds: SQL[] = [await projectVisibility(u)];
  if (!opts.includeDrafts) conds.push(ne(projects.status, "draft"));
  if (f.q?.trim()) {
    const term = `%${f.q.trim()}%`;
    conds.push(or(ilike(projects.name, term), ilike(projects.code, term), ilike(clients.name, term))!);
  }
  if (f.type === "PL" || f.type === "MP" || f.type === "MDD") conds.push(eq(projects.type, f.type));
  if (f.brand) conds.push(eq(projects.brandId, Number(f.brand)));
  if (f.category === "perfume" || f.category === "ambient" || f.category === "cosmetic") conds.push(eq(projects.category, f.category));
  if (f.status?.startsWith("g:")) {
    const g = STATUS_GROUPS[f.status.slice(2) as keyof typeof STATUS_GROUPS];
    if (g) conds.push(inArray(projects.status, g.statuses as unknown as ProjectStatus[]));
  } else if (f.status) conds.push(eq(projects.status, f.status as ProjectStatus));
  if (f.phase && /^[0-4]$/.test(f.phase)) conds.push(eq(projects.phase, Number(f.phase)));
  if (f.requester) conds.push(or(eq(projects.requesterId, f.requester), eq(projects.accountManagerId, f.requester))!);
  if (f.department)
    conds.push(sql`exists (select 1 from ${projectDepartments} pd where pd.project_id = ${projects.id} and pd.department_id = ${Number(f.department)})`);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(gte(projects.requestedAt, new Date(`${f.from}T00:00:00`)));
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(lte(projects.requestedAt, new Date(`${f.to}T23:59:59`)));
  if (f.risk === "1") conds.push(riskCondition(riskDays));
  if (f.mine === "1") conds.push(or(eq(projects.requesterId, u.id), eq(projects.accountManagerId, u.id))!);
  if (f.action === "1") conds.push(requiresMyAction(u));
  return and(...conds)!;
}

const SORTS = {
  code: projects.code,
  name: projects.name,
  requested: projects.requestedAt,
  needed: projects.neededBy,
  status: projects.status,
  phase: projects.phase,
  client: clients.name,
} as const;

export const PAGE_SIZE = 50;

export async function listProjects(u: CurrentUser, f: ProjectFilters, riskDays: number) {
  const where = await buildWhere(u, f, riskDays);
  const sortCol = SORTS[(f.sort as keyof typeof SORTS) ?? "requested"] ?? projects.requestedAt;
  const order = f.dir === "asc" ? asc(sortCol) : desc(sortCol);
  const page = Math.max(1, Number(f.page) || 1);

  const rows = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      type: projects.type,
      category: projects.category,
      status: projects.status,
      phase: projects.phase,
      priority: projects.priority,
      requestedAt: projects.requestedAt,
      neededBy: projects.neededBy,
      brandName: brands.name,
      clientName: clients.name,
      requesterName: requester.name,
      total: sql<number>`count(*) over()`.mapWith(Number),
    })
    .from(projects)
    .innerJoin(requester, eq(requester.id, projects.requesterId))
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(brands, eq(brands.id, projects.brandId))
    .where(where)
    .orderBy(sql`${order} nulls last`, desc(projects.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const ids = rows.map((r) => r.id);
  const deptRows = ids.length
    ? await db
        .select({ projectId: projectDepartments.projectId, name: departments.name, color: departments.color })
        .from(projectDepartments)
        .innerJoin(departments, eq(departments.id, projectDepartments.departmentId))
        .where(inArray(projectDepartments.projectId, ids))
    : [];
  const byProject = new Map<string, { name: string; color: string }[]>();
  for (const d of deptRows) byProject.set(d.projectId, [...(byProject.get(d.projectId) ?? []), d]);

  return {
    rows: rows.map((r) => ({ ...r, departments: byProject.get(r.id) ?? [] })),
    total: rows[0]?.total ?? 0,
    page,
  };
}

export async function myDrafts(u: CurrentUser) {
  return db
    .select({ id: projects.id, name: projects.name, type: projects.type, category: projects.category, updatedAt: projects.updatedAt, completenessPct: projects.completenessPct })
    .from(projects)
    .where(and(eq(projects.status, "draft"), eq(projects.requesterId, u.id)))
    .orderBy(desc(projects.updatedAt));
}

/** KPIs y series para el panel (§7.1). Respetan visibilidad y el periodo. */
export async function dashboardStats(u: CurrentUser, f: ProjectFilters, riskDays: number) {
  // Todos los KPIs se calculan sobre el conjunto filtrado (excepto paginación/orden)
  const where = await buildWhere(u, { ...f, page: undefined, sort: undefined }, riskDays);
  const baseQ = db
    .select({
      id: sql`${projects.id}`.as("id"),
      status: sql`${projects.status}`.as("status"),
      type: sql`${projects.type}`.as("type"),
      category: sql`${projects.category}`.as("category"),
      phase: sql`${projects.phase}`.as("phase"),
      brand: sql`${brands.name}`.as("brand"),
      requester: sql`${requester.name}`.as("requester"),
      requested_at: sql`${projects.requestedAt}`.as("requested_at"),
      decided_g1_at: sql`${projects.decidedG1At}`.as("decided_g1_at"),
      needed_by: sql`${projects.neededBy}`.as("needed_by"),
    })
    .from(projects)
    .innerJoin(requester, eq(requester.id, projects.requesterId))
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(brands, eq(brands.id, projects.brandId))
    .where(where);
  const base = sql`(${baseQ}) as base`;

  const q = <T extends Record<string, unknown>>(query: SQL) => db.execute<T>(query).then((r) => r.rows);

  const [totalsRows, byStatus, byPhase, monthly] = await Promise.all([
    q<Record<string, string | number | null>>(sql`
      select
        count(*)::int as total,
        count(*) filter (where status in ('submitted','info_requested'))::int as solicitados,
        count(*) filter (where status in ('in_progress','paused'))::int as en_proceso,
        count(*) filter (where status = 'in_production')::int as cerrados,
        count(*) filter (where status in ('rejected','cancelled'))::int as rechazados,
        count(*) filter (where type = 'PL')::int as pl,
        count(*) filter (where type = 'MP')::int as mp,
        count(*) filter (where decided_g1_at is not null)::int as approved_g1,
        count(*) filter (where status = 'rejected')::int as rejected_g1,
        avg(extract(epoch from (decided_g1_at - requested_at)) / 86400) as avg_days_g1,
        count(*) filter (where status in ('submitted','info_requested','in_progress','paused') and needed_by <= current_date + ${riskDays}::int)::int as at_risk
      from ${base}`),
    q<{ key: string; n: number }>(sql`select status::text as key, count(*)::int as n from ${base} group by 1 order by 2 desc`),
    q<{ phase: number; n: number }>(
      sql`select phase, count(*)::int as n from ${base} where status in ('submitted','info_requested','in_progress','paused','in_production') group by 1 order by 1`,
    ),
    q<{ month: string; pl: number; mp: number; mdd: number }>(sql`
      with m as (
        select generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') as month
      )
      select to_char(m.month, 'YYYY-MM') as month,
        count(base.id) filter (where base.type = 'PL')::int as pl,
        count(base.id) filter (where base.type = 'MP')::int as mp,
        count(base.id) filter (where base.type = 'MDD')::int as mdd
      from m left join ${base} on date_trunc('month', base.requested_at at time zone 'Europe/Madrid') = m.month
      group by m.month order by m.month`),
  ]);
  const t = totalsRows[0] ?? {};
  const n = (k: string) => Number(t[k] ?? 0);

  return {
    totals: {
      total: n("total"),
      solicitados: n("solicitados"),
      enProceso: n("en_proceso"),
      cerrados: n("cerrados"),
      rechazados: n("rechazados"),
      pl: n("pl"),
      mp: n("mp"),
      approvedG1: n("approved_g1"),
      rejectedG1: n("rejected_g1"),
      avgDaysToG1: t.avg_days_g1 == null ? null : Number(t.avg_days_g1),
      atRisk: n("at_risk"),
    },
    byStatus: byStatus.map((r) => ({ key: r.key, n: Number(r.n) })),
    byPhase: byPhase.map((r) => ({ phase: Number(r.phase), n: Number(r.n) })),
    monthly: monthly.map((r) => ({ month: r.month, pl: Number(r.pl), mp: Number(r.mp), mdd: Number(r.mdd) })),
  };
}

export async function filterOptions() {
  const [brandRows, deptRows, requesterRows] = await Promise.all([
    db.select({ id: brands.id, name: brands.name }).from(brands).orderBy(brands.name),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.isActive, true)).orderBy(departments.sort),
    db
      .selectDistinct({ id: users.id, name: users.name })
      .from(users)
      .innerJoin(projects, and(eq(projects.requesterId, users.id), ne(projects.status, "draft")))
      .orderBy(users.name),
  ]);
  return { brands: brandRows, departments: deptRows, requesters: requesterRows };
}

