"use server";
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  brands,
  departmentMembers,
  departments,
  deptSubstates,
  projectDeptProgress,
  gateDeciders,
  gateKey,
  projectType,
  roles,
  ROLE_KEYS,
  userRoles,
  users,
} from "@/db/schema";
import type { AppSettings } from "@/lib/catalog-defaults";
import { scalarFields, SHEET_SECTIONS } from "@/lib/sheet/sections";
import { sectionDeptKeys } from "@/lib/server/sheet";
import { logActivity } from "@/lib/server/activity";
import { requireAdminAction } from "@/lib/server/authz";
import { retryJobs } from "@/lib/server/jobs";
import { resendNotification } from "@/lib/server/notifications";
import { getSettings, setSetting } from "@/lib/server/settings";

const audit = (actorId: string, action: string, entity: string, entityId: string | number, diff?: Record<string, unknown>) =>
  logActivity({ actorId, action, entity, entityId, diff: diff ?? null });

// ─── Usuarios ─────────────────────────────────────────────────────────────

export async function updateUserAction(fd: FormData) {
  const admin = await requireAdminAction();
  const userId = z.string().uuid().parse(fd.get("userId"));
  const status = z.enum(["pending", "active", "disabled"]).parse(fd.get("status"));
  const notifPref = z.enum(["immediate", "daily"]).parse(fd.get("notifPref") ?? "immediate");
  const roleKeys = fd.getAll("roles").map(String).filter((r) => (ROLE_KEYS as readonly string[]).includes(r));
  const deptIds = fd.getAll("departments").map(Number).filter(Number.isFinite);
  if (userId === admin.id && (status !== "active" || !roleKeys.includes("admin"))) {
    throw new Error("No puedes quitarte el rol de admin ni desactivarte a ti mismo");
  }
  const [before] = await db.select().from(users).where(eq(users.id, userId));
  await db.transaction(async (tx) => {
    await tx.update(users).set({ status, isActive: status === "active", notifPref }).where(eq(users.id, userId));
    const roleRows = await tx.select().from(roles);
    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
    const ids = roleRows.filter((r) => roleKeys.includes(r.key)).map((r) => r.id);
    if (ids.length) await tx.insert(userRoles).values(ids.map((roleId) => ({ userId, roleId })));
    await tx.delete(departmentMembers).where(eq(departmentMembers.userId, userId));
    if (deptIds.length) await tx.insert(departmentMembers).values(deptIds.map((departmentId) => ({ userId, departmentId })));
  });
  await audit(admin.id, "admin.user.updated", "user", userId, { email: before?.email, status: { from: before?.status, to: status }, roles: roleKeys, departments: deptIds });
  revalidatePath("/admin/usuarios");
}

export async function createUserAction(fd: FormData) {
  const admin = await requireAdminAction();
  const email = z.string().trim().toLowerCase().email().parse(fd.get("email"));
  const name = z.string().trim().min(1).parse(fd.get("name"));
  const [u] = await db.insert(users).values({ email, name, status: "pending" }).onConflictDoNothing().returning({ id: users.id });
  if (u) await audit(admin.id, "admin.user.created", "user", u.id, { email });
  revalidatePath("/admin/usuarios");
}

// ─── Departamentos ────────────────────────────────────────────────────────

const deptSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  notifyEmails: z.array(z.string().trim().toLowerCase().email()),
  leadUserId: z.string().uuid().nullable(),
  isActive: z.boolean(),
});

function parseDept(fd: FormData) {
  return deptSchema.parse({
    name: fd.get("name"),
    color: fd.get("color"),
    notifyEmails: String(fd.get("notifyEmails") ?? "")
      .split(/[\s,;]+/)
      .filter(Boolean),
    leadUserId: null,
    isActive: fd.get("isActive") === "on",
  });
}

export async function saveDepartmentAction(fd: FormData) {
  const admin = await requireAdminAction();
  const data = parseDept(fd);
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const memberIds = fd.getAll("members").map(String);
  let deptId = id;
  if (id) {
    await db.update(departments).set(data).where(eq(departments.id, id));
  } else {
    const [row] = await db.insert(departments).values({ ...data, sort: 100 }).returning({ id: departments.id });
    deptId = row!.id;
  }
  if (fd.has("membersSubmitted")) {
    await db.delete(departmentMembers).where(eq(departmentMembers.departmentId, deptId!));
    if (memberIds.length) await db.insert(departmentMembers).values(memberIds.map((userId) => ({ userId, departmentId: deptId! })));
  }
  await audit(admin.id, id ? "admin.department.updated" : "admin.department.created", "department", deptId!, { ...data, members: memberIds.length });
  revalidatePath("/admin/departamentos");
}

// ─── Decisores por puerta ─────────────────────────────────────────────────

export async function saveDecidersAction(fd: FormData) {
  const admin = await requireAdminAction();
  const rows: { gate: (typeof gateKey.enumValues)[number]; projectType: (typeof projectType.enumValues)[number]; userId: string }[] = [];
  for (const g of gateKey.enumValues) {
    for (const t of projectType.enumValues) {
      for (const userId of fd.getAll(`${g}_${t}`).map(String)) if (userId) rows.push({ gate: g, projectType: t, userId });
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(gateDeciders);
    if (rows.length) await tx.insert(gateDeciders).values(rows);
    // Los decisores necesitan el rol "decider"
    const [decider] = await tx.select().from(roles).where(eq(roles.key, "decider"));
    const ids = [...new Set(rows.map((r) => r.userId))];
    if (decider && ids.length) await tx.insert(userRoles).values(ids.map((userId) => ({ userId, roleId: decider.id }))).onConflictDoNothing();
  });
  await audit(admin.id, "admin.deciders.updated", "gate_deciders", "matrix", { count: rows.length });
  revalidatePath("/admin/decisores");
}

// ─── Marcas propias ───────────────────────────────────────────────────────

export async function saveBrandAction(fd: FormData) {
  const admin = await requireAdminAction();
  const name = z.string().trim().min(1).max(100).parse(fd.get("name"));
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  if (id) await db.update(brands).set({ name, isActive: fd.get("isActive") === "on" }).where(eq(brands.id, id));
  else await db.insert(brands).values({ name }).onConflictDoNothing();
  await audit(admin.id, "admin.brand.saved", "brand", id ?? name, { name });
  revalidatePath("/admin/marcas");
}

// ─── Configuración ────────────────────────────────────────────────────────

export async function saveSettingsAction(fd: FormData) {
  const admin = await requireAdminAction();
  const before = await getSettings();
  const next: Omit<AppSettings, "sheet_departments"> = {
    completeness_threshold: z.coerce.number().int().min(0).max(100).parse(fd.get("completeness_threshold")),
    risk_days: z.coerce.number().int().min(1).max(365).parse(fd.get("risk_days")),
    max_file_mb: z.coerce.number().int().min(1).max(250).parse(fd.get("max_file_mb")),
    sender_mailbox: z.union([z.literal(""), z.string().trim().email()]).parse(String(fd.get("sender_mailbox") ?? "").trim()),
    requesters_see_all: fd.get("requesters_see_all") === "on",
  };
  for (const [k, v] of Object.entries(next)) await setSetting(k as keyof AppSettings, v as never);
  await audit(admin.id, "admin.settings.updated", "settings", "app", { before, after: next });
  revalidatePath("/admin/configuracion");
}

/** Departamento responsable de cada apartado de la ficha técnica. */
export async function saveSheetDepartmentsAction(fd: FormData) {
  const admin = await requireAdminAction();
  const valid = new Set((await db.select({ key: departments.key }).from(departments)).map((d) => d.key));
  const map: Record<string, string> = {};
  for (const s of SHEET_SECTIONS) {
    const v = String(fd.get(`sheet_${s.key}`) ?? "");
    if (v && v !== s.dept && valid.has(v)) map[s.key] = v;
  }
  await setSetting("sheet_departments", map);
  await audit(admin.id, "admin.sheet_departments.updated", "settings", "sheet_departments", map);
  revalidatePath("/admin/departamentos");
}

// ─── Estados (subestados) por departamento ────────────────────────────────

/** Referencias «apartado.campo» válidas para un departamento (sus apartados en la ficha). */
async function deptFieldRefs(deptKey: string) {
  const deptOf = await sectionDeptKeys();
  return new Set(SHEET_SECTIONS.filter((sec) => deptOf[sec.key] === deptKey).flatMap((sec) => scalarFields(sec).map((f) => `${sec.key}.${f.key}`)));
}

export async function addSubstateAction(fd: FormData) {
  const admin = await requireAdminAction();
  const departmentId = z.coerce.number().int().parse(fd.get("departmentId"));
  const name = z.string().trim().min(1).max(80).parse(fd.get("name"));
  const [last] = await db
    .select({ sort: deptSubstates.sort })
    .from(deptSubstates)
    .where(eq(deptSubstates.departmentId, departmentId))
    .orderBy(desc(deptSubstates.sort))
    .limit(1);
  const [row] = await db
    .insert(deptSubstates)
    .values({ departmentId, name, sort: (last?.sort ?? 0) + 10 })
    .returning({ id: deptSubstates.id });
  await audit(admin.id, "admin.substate.created", "dept_substate", row!.id, { departmentId, name });
  revalidatePath("/admin/estados");
}

export async function saveSubstateAction(fd: FormData) {
  const admin = await requireAdminAction();
  const id = z.coerce.number().int().parse(fd.get("id"));
  const [cur] = await db.select().from(deptSubstates).where(eq(deptSubstates.id, id));
  if (!cur) throw new Error("Estado no encontrado");
  const [dept] = await db.select({ key: departments.key }).from(departments).where(eq(departments.id, cur.departmentId));
  const siblings = new Set((await db.select({ id: deptSubstates.id }).from(deptSubstates).where(eq(deptSubstates.departmentId, cur.departmentId))).map((x) => x.id));
  const refs = await deptFieldRefs(dept?.key ?? "");
  const data = {
    name: z.string().trim().min(1).max(80).parse(fd.get("name")),
    sort: z.coerce.number().int().min(0).max(10000).parse(fd.get("sort")),
    isFinal: fd.get("isFinal") === "on",
    canReturnTo: fd.getAll("canReturnTo").map(Number).filter((x) => siblings.has(x) && x !== id),
    requiredFields: fd.getAll("requiredFields").map(String).filter((x) => refs.has(x)),
    promptFields: fd.getAll("promptFields").map(String).filter((x) => refs.has(x)),
  };
  await db.update(deptSubstates).set(data).where(eq(deptSubstates.id, id));
  await audit(admin.id, "admin.substate.updated", "dept_substate", id, data);
  revalidatePath("/admin/estados");
}

export async function deleteSubstateAction(fd: FormData) {
  const admin = await requireAdminAction();
  const id = z.coerce.number().int().parse(fd.get("id"));
  const [inUse] = await db.select({ n: projectDeptProgress.projectId }).from(projectDeptProgress).where(eq(projectDeptProgress.substateId, id)).limit(1);
  if (inUse) throw new Error("No se puede eliminar: hay proyectos en este estado");
  const [row] = await db.delete(deptSubstates).where(eq(deptSubstates.id, id)).returning({ departmentId: deptSubstates.departmentId, name: deptSubstates.name });
  // Quitarlo de los "puede volver a" del resto
  if (row) {
    const others = await db.select().from(deptSubstates).where(eq(deptSubstates.departmentId, row.departmentId));
    for (const o of others.filter((x) => x.canReturnTo.includes(id))) {
      await db.update(deptSubstates).set({ canReturnTo: o.canReturnTo.filter((x) => x !== id) }).where(eq(deptSubstates.id, o.id));
    }
  }
  await audit(admin.id, "admin.substate.deleted", "dept_substate", id, row ?? {});
  revalidatePath("/admin/estados");
}

// ─── Notificaciones y cola ────────────────────────────────────────────────

export async function resendNotificationAction(fd: FormData) {
  const admin = await requireAdminAction();
  const id = Number(fd.get("id"));
  await resendNotification(id);
  await audit(admin.id, "admin.notification.resent", "notification", id);
  revalidatePath("/admin/notificaciones");
}

export async function retryJobAction(fd: FormData) {
  const admin = await requireAdminAction();
  const id = Number(fd.get("id"));
  await retryJobs([id]);
  await audit(admin.id, "admin.job.retried", "job", id);
  revalidatePath("/admin/notificaciones");
}
