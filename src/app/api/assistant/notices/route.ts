import { z } from "zod";
import { getCurrentUser, isActive } from "@/lib/server/authz";
import { markNoticesRead, unreadNotices } from "@/lib/server/assistant-actions";

/** Avisos pendientes de leer (Alexia los muestra en el chat). */
export async function GET() {
  const u = await getCurrentUser();
  if (!u || !isActive(u)) return Response.json({ notices: [] }, { status: 401 });
  const list = await unreadNotices(u.id);
  return Response.json({ notices: list.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })) });
}

/** Marca avisos como leídos. */
export async function POST(req: Request) {
  const u = await getCurrentUser();
  if (!u || !isActive(u)) return Response.json({ ok: false }, { status: 401 });
  if (u.viewAs) return Response.json({ ok: true });
  const body = z.object({ ids: z.array(z.number().int().positive()).max(50) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false }, { status: 400 });
  await markNoticesRead(u.id, body.data.ids);
  return Response.json({ ok: true });
}
