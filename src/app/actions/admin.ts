"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  brands,
  catalogItems,
  clients,
  departmentMembers,
  departments,
  gateDeciders,
  gateKey,
  projectType,
  roles,
  ROLE_KEYS,
  userRoles,
  users,
} from "@/db/schema";
import { CATALOG_TYPES, type AppSettings } from "@/lib/catalog-defaults";
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
    leadUserId: fd.get("leadUserId") || null,
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

// ─── Catálogos ────────────────────────────────────────────────────────────

export async function addCatalogItemAction(fd: FormData) {
  const admin = await requireAdminAction();
  const type = z.enum(Object.keys(CATALOG_TYPES) as [string, ...string[]]).parse(fd.get("type"));
  const label = z.string().trim().min(1).max(200).parse(fd.get("label"));
  const value =
    z.string().trim().max(100).parse(fd.get("value") ?? "") ||
    label
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  await db.insert(catalogItems).values({ type, value, label, sort: 999 }).onConflictDoUpdate({ target: [catalogItems.type, catalogItems.value], set: { label, isActive: true } });
  await audit(admin.id, "admin.catalog.added", "catalog_item", `${type}:${value}`, { label });
  revalidatePath("/admin/catalogos");
}

export async function updateCatalogItemAction(fd: FormData) {
  const admin = await requireAdminAction();
  const id = Number(fd.get("id"));
  const label = z.string().trim().min(1).max(200).parse(fd.get("label"));
  const sort = Number(fd.get("sort") ?? 0) || 0;
  const isActive = fd.get("isActive") === "on";
  await db.update(catalogItems).set({ label, sort, isActive }).where(eq(catalogItems.id, id));
  await audit(admin.id, "admin.catalog.updated", "catalog_item", id, { label, sort, isActive });
  revalidatePath("/admin/catalogos");
}

export async function saveBrandAction(fd: FormData) {
  const admin = await requireAdminAction();
  const name = z.string().trim().min(1).max(100).parse(fd.get("name"));
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  if (id) await db.update(brands).set({ name, isActive: fd.get("isActive") === "on" }).where(eq(brands.id, id));
  else await db.insert(brands).values({ name }).onConflictDoNothing();
  await audit(admin.id, "admin.brand.saved", "brand", id ?? name, { name });
  revalidatePath("/admin/catalogos");
}

export async function saveClientAction(fd: FormData) {
  const admin = await requireAdminAction();
  const data = {
    name: z.string().trim().min(1).max(200).parse(fd.get("name")),
    country: String(fd.get("country") ?? "").trim() || null,
    contact: String(fd.get("contact") ?? "").trim() || null,
    externalRef: String(fd.get("externalRef") ?? "").trim() || null,
    accountManagerUserId: String(fd.get("accountManagerUserId") ?? "") || null,
  };
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  if (id) await db.update(clients).set(data).where(eq(clients.id, id));
  else await db.insert(clients).values(data);
  await audit(admin.id, "admin.client.saved", "client", id ?? data.name, data);
  revalidatePath("/admin/catalogos");
}

/** Carga inicial de clientes desde CSV: nombre;país;contacto;ref_externa */
export async function importClientsAction(fd: FormData) {
  const admin = await requireAdminAction();
  const text = String(fd.get("csv") ?? "");
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.split(/[;,\t]/).map((c) => c.trim()))
    .filter((r) => r[0] && r[0].toLowerCase() !== "nombre");
  if (!rows.length) return;
  await db.insert(clients).values(rows.map((r) => ({ name: r[0]!, country: r[1] || null, contact: r[2] || null, externalRef: r[3] || null })));
  await audit(admin.id, "admin.client.imported", "client", "csv", { count: rows.length });
  revalidatePath("/admin/catalogos");
}

// ─── Configuración ────────────────────────────────────────────────────────

export async function saveSettingsAction(fd: FormData) {
  const admin = await requireAdminAction();
  const before = await getSettings();
  const next: AppSettings = {
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
