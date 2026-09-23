import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { notificationLog } from "@/db/schema";
import { getCurrentUser, isActive, isAdmin } from "@/lib/server/authz";
import { escapeHtml } from "@/lib/utils";

/** Vista previa del email tal como se envía (o se enviaría) — solo admin. */
export async function GET(_req: Request, ctx: RouteContext<"/api/admin/notifications/[id]">) {
  const u = await getCurrentUser();
  if (!u || !isActive(u) || !isAdmin(u)) return new NextResponse("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  const [n] = await db.select().from(notificationLog).where(eq(notificationLog.id, Number(id)));
  if (!n) return new NextResponse("Not found", { status: 404 });
  const header = `<div style="font:13px Segoe UI,Arial,sans-serif;background:#fffbeb;border-bottom:1px solid #fcd34d;padding:10px 16px">
<b>Para:</b> ${escapeHtml(n.recipients.join(", "))}<br><b>Asunto:</b> ${escapeHtml(n.subject)}<br><b>Estado:</b> ${escapeHtml(n.status)}</div>`;
  return new NextResponse(n.html.replace(/<body([^>]*)>/, `<body$1>${header}`), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // El HTML lo genera la app; aun así, sin scripts
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:",
    },
  });
}
