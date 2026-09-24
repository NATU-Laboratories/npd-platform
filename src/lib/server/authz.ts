import "server-only";
import { cache } from "react";
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
};

export class AuthzError extends Error {
  constructor(message = "No tienes permiso para realizar esta acción") {
    super(message);
    this.name = "AuthzError";
  }
}

/** Carga el usuario de la sesión desde BD en cada petición (desactivaciones inmediatas). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
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
});

export function isActive(u: CurrentUser | null): boolean {
  return !!u && u.status === "active" && u.roles.length > 0;
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
  if (!u || !isActive(u)) throw new AuthzError("Sesión no válida o usuario no activado");
  return u;
}

export function hasRole(u: CurrentUser, ...r: RoleKey[]) {
  return r.some((k) => u.roles.includes(k));
}

export function isAdmin(u: CurrentUser) {
  return u.roles.includes("admin");
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
  return hasRole(u, "requester", "admin");
}

/**
 * Condición SQL de visibilidad de proyectos para un usuario (§4).
 * Los borradores solo los ve su autor.
 */
export async function projectVisibility(u: CurrentUser): Promise<SQL> {
  const notDraft = ne(projects.status, "draft");
  const ownDraft = and(eq(projects.status, "draft"), eq(projects.requesterId, u.id))!;
  if (hasRole(u, "admin", "global_reader") || isMarketing(u)) return or(notDraft, ownDraft)!;

  const conds: SQL[] = [
    and(notDraft, or(eq(projects.requesterId, u.id), eq(projects.accountManagerId, u.id)))!,
    ownDraft,
  ];
  if (hasRole(u, "requester") && (await getSettings()).requesters_see_all) conds.push(notDraft);
  if (hasRole(u, "decider") && u.deciderFor.length) {
    const types = [...new Set(u.deciderFor.map((d) => d.projectType))];
    conds.push(and(notDraft, inArray(projects.type, types))!);
  }
  if (hasRole(u, "dept_member") && u.departmentIds.length) {
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
  if (isAdmin(u) || isMarketing(u)) return true;
  return p.requesterId === u.id && (p.status === "submitted" || p.status === "info_requested");
}

export function canDecideGate(u: CurrentUser, p: Pick<Project, "type">, gate: GateKey) {
  if (isAdmin(u)) return true;
  if (!hasRole(u, "decider")) return false;
  return u.deciderFor.some((d) => d.gate === gate && d.projectType === p.type);
}

/** Pausar/reanudar/cancelar/avanzar fase: Admin, Marketing y aprobadores (G1/G2) del tipo de proyecto. */
export function canManageProject(u: CurrentUser, p: Pick<Project, "type" | "phase">) {
  return isAdmin(u) || isMarketing(u) || canDecideGate(u, p, "G1") || canDecideGate(u, p, "G2");
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
