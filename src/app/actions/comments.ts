"use server";
import { revalidatePath } from "next/cache";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { comments, departments, users } from "@/db/schema";
import { logActivity } from "@/lib/server/activity";
import { canViewProject, requireActionUser } from "@/lib/server/authz";
import { logError } from "@/lib/server/errors";
import { notifyMentions } from "@/lib/server/notifications";
import type { ActionResult } from "./projects";

export async function addCommentAction(
  projectId: string,
  body: string,
  mentions: { users: string[]; departments: number[] },
): Promise<ActionResult> {
  try {
    const u = await requireActionUser();
    if (!(await canViewProject(u, projectId))) return { ok: false, error: "Sin permiso" };
    const text = body.trim();
    if (!text) return { ok: false, error: "El comentario está vacío" };
    if (text.length > 10000) return { ok: false, error: "Comentario demasiado largo" };
    // Solo menciones válidas y presentes en el texto
    const userRows = mentions.users.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, mentions.users.slice(0, 50))) : [];
    const deptRows = mentions.departments.length
      ? await db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, mentions.departments.slice(0, 20)))
      : [];
    const valid = {
      users: userRows.filter((r) => text.includes(`@${r.name}`)).map((r) => r.id),
      departments: deptRows.filter((r) => text.includes(`@${r.name}`)).map((r) => r.id),
    };
    const [c] = await db.insert(comments).values({ projectId, authorId: u.id, body: text, mentions: valid }).returning({ id: comments.id });
    await logActivity({ projectId, actorId: u.id, action: "comment.created", entity: "comment", entityId: c!.id, diff: { body: text.slice(0, 500) } });
    await notifyMentions(c!.id);
    revalidatePath(`/proyectos/${projectId}`);
    return { ok: true };
  } catch (err) {
    await logError("action:addComment", err, { projectId });
    return { ok: false, error: "No se pudo publicar el comentario" };
  }
}
