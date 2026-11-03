import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  departmentMembers,
  departments,
  gateDeciders,
  projectDepartments,
  projects,
  roles,
  userRoles,
  users,
  type GateKey,
  type Project,
  type RoleKey,
} from "@/db/schema";
import { getSettings } from "./settings";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  status: "pending" | "active" | "disabled";
  roles: RoleKey[];
  departmentIds: number[];
  departmentKeys: string[];
  deciderFor: { gate: GateKey; projectType: "PL" | "MP" | "MDD" }[];
  /** Presente cuando un admin está previsualizando la plataforma como este usuario. */
  viewAs?: { adminName: string };
};

export class AuthzError extends Error {
  constructor(message = "No tienes permiso para realizar esta acción") {
    super(message);
    this.name = "AuthzError";
  }
}

/** Cookie del modo «Ver como» (solo la honra el servidor si el usuario real es admin). */
export const VIEW_AS_COOKIE = "npd_view_as";

export async function loadUser(id: string): Promise<CurrentUser | null> {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) return null;
  const [roleRows, deptRows, deciderRows] = await Promise.all([
    db.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, id)),
    db
      .select({ id: departments.id, key: departments.key })
      .from(departmentMembers)
      .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
      .where(eq(departmentMembers.userId, id)),
    db.select({ gate: gateDeciders.gate, projectType: gateDeciders.projectType }).from(gateDeciders).where(eq(gateDeciders.userId, id)),
  ]);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    status: u.status,
    roles: roleRows.map((r) => r.key),
    departmentIds: deptRows.map((d) => d.id),
    departmentKeys: deptRows.map((d) => d.key ?? ""),
    deciderFor: deciderRows,
  };
}

/** Usuario real de la sesión (ignora el modo «Ver como»). */
export const getRealUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  return id ? loadUser(id) : null;
});

/**
 * Carga el usuario de la sesión desde BD en cada petición (desactivaciones inmediatas).
 * Si un admin está en modo «Ver como», devuelve el usuario previsualizado con `viewAs`
 * (solo lectura: requireActionUser rechaza cualquier cambio).
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const real = await getRealUser();
  if (!real) return null;
  const viewAs = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  if (viewAs && viewAs !== real.id && isAdmin(real) && real.status === "active") {
    const target = await loadUser(viewAs);
    if (target) return { ...target, viewAs: { adminName: real.name } };
  }
  return real;
});

/** Activo: estado «Activo» y al menos un rol, un departamento o una asignación como aprobador. */
export function isActive(u: CurrentUser | null): boolean {
  return !!u && u.status === "active" && (u.roles.length > 0 || u.departmentIds.length > 0 || u.deciderFor.length > 0);
}

/** Para páginas: redirige a login o a "pendiente de activación". */
export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (!isActive(u)) redirect("/pendiente");
  return u;
}

/** Para server actions / route handlers: lanza en lugar de redirigir. */
export async function requireActionUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (u?.viewAs) throw new AuthzError(`Vista previa como ${u.name}: no se pueden hacer cambios. Sal de la vista previa para continuar.`);
  if (!u || !isActive(u)) throw new AuthzError("Sesión no válida o usuario no activado");
  return u;
}

export function hasRole(u: CurrentUser, ...r: RoleKey[]) {
  return r.some((k) => u.roles.includes(k));
}

export function isAdmin(u: CurrentUser) {
  return u.roles.includes("admin");
}

/** Decisor global (gestor de proyectos): decide, rellena y avanza en todas las fases de todos los proyectos. */
export function isGlobalDecider(u: CurrentUser) {
  return u.roles.includes("global_decider");
}

export function isMarketing(u: CurrentUser) {
  return u.departmentKeys.includes("marketing");
}

export async function requireAdmin() {
  const u = await requireUser();
  if (!isAdmin(u)) redirect("/");
  return u;
}

export async function requireAdminAction() {
  const u = await requireActionUser();
  if (!isAdmin(u)) throw new AuthzError();
  return u;
}

/** ¿Puede crear solicitudes? */
export function canRequest(u: CurrentUser) {
  return hasRole(u, "requester", "admin", "global_decider");
}

/** Admin y gestor de proyectos pueden dar de alta solicitudes en nombre de otro usuario. */
export function canRequestOnBehalf(u: CurrentUser) {
  return isAdmin(u) || isGlobalDecider(u);
}

/**
 * Condición SQL de visibilidad de proyectos para un usuario (§4).
 * Los borradores solo los ve su autor.
 */
export async function projectVisibility(u: CurrentUser): Promise<SQL> {
  const notDraft = ne(projects.status, "draft");
  const ownDraft = and(eq(projects.status, "draft"), eq(projects.requesterId, u.id))!;
  if (hasRole(u, "admin", "global_decider", "global_reader") || isMarketing(u)) return or(notDraft, ownDraft)!;

  const conds: SQL[] = [
    and(notDraft, or(eq(projects.requesterId, u.id), eq(projects.accountManagerId, u.id)))!,
    ownDraft,
  ];
  if (hasRole(u, "requester") && (await getSettings()).requesters_see_all) conds.push(notDraft);
  // Aprobadores (asignados en Backoffice → Aprobadores): ven los proyectos de los tipos que aprueban
  if (u.deciderFor.length) {
    const types = [...new Set(u.deciderFor.map((d) => d.projectType))];
    conds.push(and(notDraft, inArray(projects.type, types))!);
  }
  // Pertenecer a un departamento basta para ver los proyectos en los que está implicado
  if (u.departmentIds.length) {
    conds.push(
      and(
        notDraft,
        sql`exists (select 1 from ${projectDepartments} pd where pd.project_id = ${projects.id} and pd.department_id in ${u.departmentIds})`,
      )!,
    );
  }
  return or(...conds)!;
}

export async function canViewProject(u: CurrentUser, projectId: string) {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), await projectVisibility(u)));
  return !!row;
}

export function canEditBrief(u: CurrentUser, p: Pick<Project, "requesterId" | "status">) {
  if (p.status === "draft") return p.requesterId === u.id;
  if (isAdmin(u) || isGlobalDecider(u) || isMarketing(u)) return true;
  return p.requesterId === u.id && (p.status === "submitted" || p.status === "info_requested");
}

/** Aprobador configurado en el backoffice para esa puerta y tipo de proyecto. */
function isConfiguredDecider(u: CurrentUser, p: Pick<Project, "type">, gate: GateKey) {
  return u.deciderFor.some((d) => d.gate === gate && d.projectType === p.type);
}

/**
 * ¿Puede decidir la puerta? Admin, decisor global, aprobadores configurados y,
 * en G2 (aprobación del presupuesto), siempre el comercial que dio de alta el proyecto.
 */
export function canDecideGate(u: CurrentUser, p: Pick<Project, "type" | "requesterId">, gate: GateKey) {
  if (isAdmin(u) || isGlobalDecider(u)) return true;
  if (gate === "G2" && p.requesterId === u.id) return true;
  return isConfiguredDecider(u, p, gate);
}

/** Pausar/reanudar/cancelar/avanzar fase: Admin, decisor global, Marketing y aprobadores (G1/G2) del tipo de proyecto. */
export function canManageProject(u: CurrentUser, p: Pick<Project, "type" | "phase">) {
  return isAdmin(u) || isGlobalDecider(u) || isMarketing(u) || isConfiguredDecider(u, p, "G1") || isConfiguredDecider(u, p, "G2");
}

/** Completar los datos para la etiqueta (naming, facing, idiomas, países): el comercial y los gestores. */
export function canCompleteLabelInfo(u: CurrentUser, p: Pick<Project, "requesterId" | "accountManagerId">) {
  return p.requesterId === u.id || p.accountManagerId === u.id || isAdmin(u) || isGlobalDecider(u) || isMarketing(u);
}

/**
 * Coste objetivo de la fórmula (confidencial): Laboratorio / I+D, el gestor de
 * proyectos (decisor global), admin y Operaciones (quien prepara la cotización).
 * Nunca Comercial ni el resto de departamentos.
 */
export function canSeeFormulaCost(u: CurrentUser) {
  return isAdmin(u) || isGlobalDecider(u) || u.departmentKeys.includes("idi") || u.departmentKeys.includes("operaciones");
}

/** Enviar la cotización al cliente (fase Cotización): gestores, comercial de la cuenta, Operaciones y Comercial. */
export function canSendQuote(u: CurrentUser, p: Pick<Project, "type" | "phase" | "accountManagerId" | "requesterId">) {
  return (
    canManageProject(u, p) ||
    p.accountManagerId === u.id ||
    u.departmentKeys.includes("operaciones") ||
    u.departmentKeys.includes("comercial")
  );
}
