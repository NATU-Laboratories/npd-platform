"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projectComponents } from "@/db/schema";
import { AuthzError, requireActionUser } from "@/lib/server/authz";
import { logError } from "@/lib/server/errors";
import {
  addComponent,
  chooseComponentQuote,
  componentQuoteEmails,
  deleteComponent,
  PurchasingError,
  registerComponentQuote,
  requestComponentQuotes,
  setComponentSupplier,
  updateComponent,
} from "@/lib/server/purchasing";
import type { RepEmail } from "@/lib/server/replenishments";
import type { ActionResult } from "./projects";

async function run<T>(name: string, projectId: string | null, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    if (projectId) revalidatePath(`/proyectos/${projectId}`);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof PurchasingError || err instanceof AuthzError) return { ok: false, error: err.message };
    if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Datos no válidos" };
    await logError(`action:${name}`, err, { projectId });
    return { ok: false, error: "Se ha producido un error inesperado. Queda registrado en el log." };
  }
}

const uuid = z.string().uuid();
const id = z.number().int().positive();
const message = z.string().max(4000);

async function projectOf(componentId: number) {
  const [c] = await db.select({ projectId: projectComponents.projectId }).from(projectComponents).where(eq(projectComponents.id, componentId));
  return c?.projectId ?? null;
}

export async function addComponentAction(projectId: string, component: string, description: string | null) {
  return run("purchasing:add", projectId, async () => addComponent(await requireActionUser(), uuid.parse(projectId), { component, description }));
}

export async function updateComponentAction(componentId: number, description: string | null) {
  return run("purchasing:update", await projectOf(Number(componentId) || 0), async () => updateComponent(await requireActionUser(), componentId, description));
}

export async function deleteComponentAction(componentId: number) {
  return run("purchasing:delete", await projectOf(Number(componentId) || 0), async () => deleteComponent(await requireActionUser(), componentId));
}

export async function setComponentSupplierAction(input: { componentId: number; slot: number; supplierId?: number | null; newSupplier?: { name: string; email?: string } | null }) {
  return run("purchasing:supplier", await projectOf(Number(input.componentId) || 0), async () => setComponentSupplier(await requireActionUser(), input));
}

export async function registerComponentQuoteAction(componentId: number, input: { quoteId: number; price: string; notes?: string | null }) {
  return run("purchasing:quote", await projectOf(Number(componentId) || 0), async () => registerComponentQuote(await requireActionUser(), input));
}

export async function chooseComponentQuoteAction(componentId: number, quoteId: number | null, comment?: string | null) {
  return run("purchasing:choose", await projectOf(Number(componentId) || 0), async () =>
    chooseComponentQuote(await requireActionUser(), componentId, quoteId == null ? null : id.parse(quoteId), comment),
  );
}

export async function previewComponentQuotesAction(projectId: string, supplierId: number | null, componentId: number | null, msg: string): Promise<ActionResult<RepEmail[]>> {
  return run("purchasing:preview", null, async () =>
    (await componentQuoteEmails(await requireActionUser(), uuid.parse(projectId), supplierId, componentId, message.parse(msg))).map((e): RepEmail => ({
      key: e.key,
      audience: e.audience,
      label: e.label,
      to: e.to,
      replyTo: e.replyTo,
      subject: e.subject,
      html: e.html,
      supplierId: e.supplierId,
    })),
  );
}

export async function requestComponentQuotesAction(projectId: string, supplierId: number | null, componentId: number | null, msg: string) {
  return run("purchasing:request", projectId, async () => requestComponentQuotes(await requireActionUser(), uuid.parse(projectId), supplierId, componentId, message.parse(msg)));
}
