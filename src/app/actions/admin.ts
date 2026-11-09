"use server";
import { inboundUrlToken } from "@/lib/server/reply-address";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  brands,
  clients,
  departmentMembers,
  departments,
  deptSubstates,
  projectDeptProgress,
  gateDeciders,
  replenishmentItems,
  suppliers,
  gateKey,
  projectType,
  roles,
  userRoles,
  users,
} from "@/db/schema";
import type { AppSettings } from "@/lib/catalog-defaults";
import { EDITABLE_ROLES, TEST_EMAIL_DOMAIN } from "@/lib/labels";
import { scalarFields, SHEET_SECTIONS } from "@/lib/sheet/sections";
import { sectionDeptKeys } from "@/lib/server/sheet";
import { logActivity } from "@/lib/server/activity";
import { AuthzError, getRealUser, requireAdminAction, VIEW_AS_COOKIE } from "@/lib/server/authz";
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
  // Solo se editan a mano los roles de EDITABLE_ROLES; «Aprobador» y «Miembro de departamento» se deducen
  const roleKeys = fd.getAll("roles").map(String).filter((r) => (EDITABLE_ROLES as readonly string[]).includes(r));
  const deptIds = fd.getAll("departments").map(Number).filter(Number.isFinite);
  // Email vacío = sin cambios (los usuarios de prueba siguen con su dirección ficticia)
  const rawEmail = String(fd.get("email") ?? "").trim().toLowerCase();
  const newEmail = rawEmail ? z.string().email("Email no válido").parse(rawEmail) : null;
  if (newEmail) {
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, newEmail));
    if (taken && taken.id !== userId) throw new Error("Ese email ya lo usa otro usuario");
  }
  if (userId === admin.id && (status !== "active" || !roleKeys.includes("admin"))) {
    throw new Error("No puedes quitarte el rol de admin ni desactivarte a ti mismo");
  }
  const [before] = await db.select().from(users).where(eq(users.id, userId));
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ status, isActive: status === "active", ...(newEmail ? { email: newEmail } : {}) })
      .where(eq(users.id, userId));
    const roleRows = await tx.select().from(roles);
    const editable = roleRows.filter((r) => (EDITABLE_ROLES as readonly string[]).includes(r.key)).map((r) => r.id);
    if (editable.length) await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), inArray(userRoles.roleId, editable)));
    const ids = roleRows.filter((r) => roleKeys.includes(r.key)).map((r) => r.id);
    if (ids.length) await tx.insert(userRoles).values(ids.map((roleId) => ({ userId, roleId })));
    await tx.delete(departmentMembers).where(eq(departmentMembers.userId, userId));
    if (deptIds.length) await tx.insert(departmentMembers).values(deptIds.map((departmentId) => ({ userId, departmentId })));
  });
  await audit(admin.id, "admin.user.updated", "user", userId, { email: before?.email, ...(newEmail && newEmail !== before?.email ? { newEmail } : {}), status: { from: before?.status, to: status }, roles: roleKeys, departments: deptIds });
  revalidatePath("/admin/usuarios");
}

/**
 * Autoriza a una persona: solo quien está aquí (con su email corporativo) puede entrar
 * con Microsoft 365. Se da de alta ya activa, con sus roles y departamentos.
 */
export async function createUserAction(fd: FormData) {
  const admin = await requireAdminAction();
  const name = z.string().trim().min(1, "Pon el nombre").max(200).parse(fd.get("name"));
  const rawEmail = String(fd.get("email") ?? "").trim().toLowerCase();
  // Sin email (pruebas): dirección ficticia que nunca recibe correos ni puede entrar; se puede cambiar después
  const email = rawEmail ? z.string().email("Email no válido").parse(rawEmail) : `pruebas-${crypto.randomUUID().slice(0, 8)}@${TEST_EMAIL_DOMAIN}`;
  const roleKeys = fd.getAll("roles").map(String).filter((r) => (EDITABLE_ROLES as readonly string[]).includes(r));
  const deptIds = fd.getAll("departments").map(Number).filter(Number.isFinite);
  const [dup] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (dup) throw new Error("Ya hay un usuario con ese email: edítalo en la lista");
  const status = rawEmail && (roleKeys.length || deptIds.length) ? "active" : "pending";
  const id = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({ email, name, status, isActive: status === "active" }).returning({ id: users.id });
    const roleRows = await tx.select().from(roles);
    const ids = roleRows.filter((r) => roleKeys.includes(r.key)).map((r) => r.id);
    if (ids.length) await tx.insert(userRoles).values(ids.map((roleId) => ({ userId: u!.id, roleId })));
    if (deptIds.length) await tx.insert(departmentMembers).values(deptIds.map((departmentId) => ({ userId: u!.id, departmentId })));
    return u!.id;
  });
  await audit(admin.id, "admin.user.created", "user", id, { email, status, roles: roleKeys, departments: deptIds });
  revalidatePath("/admin/usuarios");
}

/**
 * Elimina un usuario sin actividad en proyectos (pruebas, preregistros, altas por
 * error). Si tiene historial (solicitudes, decisiones, comentarios, archivos,
 * actividad), no se borra para no perder la trazabilidad: hay que desactivarlo.
 */
export async function deleteUserAction(userId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdminAction();
  const id = z.string().uuid().parse(userId);
  if (id === admin.id) return { ok: false, error: "No puedes eliminarte a ti mismo" };
  const [u] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, id));
  if (!u) return { ok: false, error: "Usuario no encontrado" };
  try {
    await db.transaction(async (tx) => {
      await tx.update(clients).set({ accountManagerUserId: null }).where(eq(clients.accountManagerUserId, id));
      await tx.delete(users).where(eq(users.id, id));
    });
  } catch (err) {
    // 23503: violación de clave foránea → el usuario tiene historial en proyectos
    if ((err as { code?: string; cause?: { code?: string } }).code === "23503" || (err as { cause?: { code?: string } }).cause?.code === "23503") {
      return { ok: false, error: `${u.name} tiene actividad en proyectos y no se puede eliminar sin perder el historial. Desactívalo en su lugar (Estado → Desactivado).` };
    }
    throw err;
  }
  await audit(admin.id, "admin.user.deleted", "user", id, { email: u.email, name: u.name });
  revalidatePath("/admin/usuarios");
  return { ok: true };
}

// ─── Vista previa «Ver como» (solo admin, solo lectura) ───────────────────

export async function viewAsAction(fd: FormData) {
  const real = await getRealUser();
  if (!real || real.status !== "active" || !real.roles.includes("admin")) throw new AuthzError();
  const userId = z.string().uuid().parse(fd.get("userId"));
  if (userId === real.id) return;
  const [target] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId));
  if (!target) throw new Error("Usuario no encontrado");
  (await cookies()).set(VIEW_AS_COOKIE, userId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 8 * 3600 });
  await audit(real.id, "admin.view_as", "user", userId, { email: target.email });
  redirect("/");
}

export async function stopViewAsAction() {
  (await cookies()).delete(VIEW_AS_COOKIE);
  redirect("/admin/usuarios");
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
    risk_warning_days: z.coerce.number().int().min(1).max(90).parse(fd.get("risk_warning_days")),
    quote_followup_days: z.coerce.number().int().min(1).max(30).parse(fd.get("quote_followup_days")),
    supplier_reply_cc: z
      .array(z.string().email("Revisa los emails de «Reciben también las respuestas de proveedores»"))
      .max(20)
      .parse(
        String(fd.get("supplier_reply_cc") ?? "")
          .split(/[\s,;]+/)
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      ),
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

/** Email de prueba a quien lo pide (comprueba el buzón remitente y el modo de envío). */
export async function sendTestEmailAction() {
  const admin = await requireAdminAction();
  const { queueNotification } = await import("@/lib/server/notifications");
  const { renderEmail } = await import("@/lib/server/email-template");
  await queueNotification({
    event: "admin.test",
    recipients: [admin.email],
    subject: "Email de prueba de la plataforma NPD",
    html: renderEmail({
      title: "Email de prueba",
      intro: `Si estás leyendo esto, el envío de emails de la plataforma funciona. Lo has pedido desde Backoffice → Notificaciones (${new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}).`,
      ctaPath: "/admin/notificaciones",
      ctaLabel: "Ver notificaciones",
    }),
  });
  revalidatePath("/admin/notificaciones");
}

/**
 * Conecta en Brevo la recepción de respuestas de proveedores: los emails a INBOUND_DOMAIN se
 * envían a /api/inbound/brevo (webhook de entrada). Requiere BREVO_API_KEY, INBOUND_DOMAIN,
 * INBOUND_SECRET y APP_URL, y el registro MX del subdominio apuntando a Brevo.
 */
export async function connectInboundAction() {
  await requireAdminAction();
  const key = process.env.BREVO_API_KEY?.trim();
  const domain = process.env.INBOUND_DOMAIN?.trim().toLowerCase();
  const secret = process.env.INBOUND_SECRET;
  const app = process.env.APP_URL?.replace(/\/$/, "");
  const missing = [!key && "BREVO_API_KEY", !domain && "INBOUND_DOMAIN", !secret && "INBOUND_SECRET", !app && "APP_URL"].filter(Boolean);
  let result: string;
  if (missing.length) result = `Faltan variables en Vercel: ${missing.join(", ")}`;
  else {
    const r = await fetch("https://api.brevo.com/v3/webhooks", {
      method: "POST",
      headers: { "api-key": key!, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        type: "inbound",
        events: ["inboundEmailProcessed"],
        url: `${app}/api/inbound/brevo/${inboundUrlToken()}`,
        domain,
        description: "Plataforma NPD: respuestas de proveedores",
      }),
    }).catch((err: unknown) => ({ ok: false, status: 0, json: async () => ({ message: String(err) }) }) as unknown as Response);
    const body = (await r.json().catch(() => null)) as { message?: string; id?: number } | null;
    result = r.ok ? "ok" : `Brevo ${r.status}: ${body?.message ?? "error"}`;
  }
  redirect(`/admin/notificaciones?entrada=${encodeURIComponent(result)}`);
}

/** Webhooks de entrada registrados en Brevo (para comprobar que apuntan a la dirección actual). */
export async function inboundStatus(): Promise<{ ok: boolean; error?: string; hooks: { id: number; url: string; domain: string | null; current: boolean }[] }> {
  await requireAdminAction();
  const key = process.env.BREVO_API_KEY?.trim();
  if (!key) return { ok: false, error: "Falta BREVO_API_KEY", hooks: [] };
  const app = process.env.APP_URL?.replace(/\/$/, "") ?? "";
  const expected = `${app}/api/inbound/brevo/${inboundUrlToken()}`;
  const r = await fetch("https://api.brevo.com/v3/webhooks?type=inbound", { headers: { "api-key": key, accept: "application/json" }, cache: "no-store" }).catch(() => null);
  if (!r) return { ok: false, error: "No se pudo contactar con Brevo", hooks: [] };
  const body = (await r.json().catch(() => null)) as { webhooks?: { id: number; url: string; domain?: string }[]; message?: string } | null;
  if (!r.ok) return { ok: false, error: `Brevo ${r.status}: ${body?.message ?? "error"}`, hooks: [] };
  return {
    ok: true,
    hooks: (body?.webhooks ?? []).map((h) => ({ id: h.id, url: h.url.replace(/(\/api\/inbound\/brevo\/)([0-9a-f]{6})[0-9a-f]+/, "$1$2…"), domain: h.domain ?? null, current: h.url === expected })),
  };
}

/** Borra los webhooks de entrada antiguos (los que no apuntan a la dirección actual). */
export async function cleanInboundAction() {
  await requireAdminAction();
  const key = process.env.BREVO_API_KEY?.trim();
  const app = process.env.APP_URL?.replace(/\/$/, "") ?? "";
  const expected = `${app}/api/inbound/brevo/${inboundUrlToken()}`;
  let removed = 0;
  if (key) {
    const r = await fetch("https://api.brevo.com/v3/webhooks?type=inbound", { headers: { "api-key": key, accept: "application/json" }, cache: "no-store" });
    const body = (await r.json().catch(() => null)) as { webhooks?: { id: number; url: string }[] } | null;
    for (const h of body?.webhooks ?? [])
      if (h.url !== expected) {
        await fetch(`https://api.brevo.com/v3/webhooks/${h.id}`, { method: "DELETE", headers: { "api-key": key } });
        removed++;
      }
  }
  redirect(`/admin/notificaciones?entrada=${encodeURIComponent(removed ? `Borrados ${removed} webhooks antiguos` : "No había webhooks antiguos")}`);
}

/** Pasa a SharePoint los archivos que aún están en el almacenamiento provisional (por tandas). */
export async function migrateStorageAction() {
  await requireAdminAction();
  const { migrateStep } = await import("@/lib/server/storage-migration");
  let msg: string;
  try {
    const { done, pending } = await migrateStep();
    const left = pending.projects + pending.files + pending.repFiles;
    msg = `Pasados ${done.files + done.repFiles} archivos y ${done.projects} carpetas de proyecto${done.errors ? ` (${done.errors} con error: mira Errores)` : ""}. ${left ? `Quedan ${pending.files + pending.repFiles} archivos y ${pending.projects} carpetas: vuelve a pulsar.` : "Todo está ya en SharePoint."}`;
  } catch (err) {
    msg = err instanceof Error ? err.message : "No se ha podido completar";
  }
  redirect(`/admin?sharepoint=${encodeURIComponent(msg)}`);
}

export async function retryJobAction(fd: FormData) {
  const admin = await requireAdminAction();
  const id = Number(fd.get("id"));
  await retryJobs([id]);
  await audit(admin.id, "admin.job.retried", "job", id);
  revalidatePath("/admin/notificaciones");
}

// ─── Proveedores (Reposiciones) ───────────────────────────────────────────

export async function saveSupplierAction(fd: FormData) {
  const admin = await requireAdminAction();
  const id = fd.get("id") ? Number(fd.get("id")) : null;
  const name = z.string().trim().min(1, "Pon el nombre del proveedor").max(200).parse(fd.get("name"));
  const emails = String(fd.get("emails") ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  for (const e of emails) z.string().email(`Email no válido: ${e}`).parse(e);
  const values = {
    name,
    emails: [...new Set(emails)],
    contactName: String(fd.get("contactName") ?? "").trim() || null,
    phone: String(fd.get("phone") ?? "").trim() || null,
    notes: String(fd.get("notes") ?? "").trim() || null,
    isActive: id ? fd.get("isActive") === "on" : true,
  };
  if (id) await db.update(suppliers).set(values).where(eq(suppliers.id, id));
  else await db.insert(suppliers).values(values).onConflictDoNothing();
  await audit(admin.id, id ? "admin.supplier.updated" : "admin.supplier.created", "supplier", id ?? name, { name });
  revalidatePath("/admin/proveedores");
}

/** Elimina un proveedor; si tiene reposiciones, solo se desactiva para no perder el historial. */
export async function deleteSupplierAction(id: number): Promise<{ ok: boolean; error?: string; deactivated?: boolean }> {
  const admin = await requireAdminAction();
  const sid = z.number().int().positive().parse(id);
  const [used] = await db.select({ id: replenishmentItems.id }).from(replenishmentItems).where(eq(replenishmentItems.supplierId, sid)).limit(1);
  if (used) {
    await db.update(suppliers).set({ isActive: false }).where(eq(suppliers.id, sid));
    await audit(admin.id, "admin.supplier.deactivated", "supplier", sid);
    revalidatePath("/admin/proveedores");
    return { ok: true, deactivated: true };
  }
  await db.delete(suppliers).where(eq(suppliers.id, sid));
  await audit(admin.id, "admin.supplier.deleted", "supplier", sid);
  revalidatePath("/admin/proveedores");
  return { ok: true };
}
