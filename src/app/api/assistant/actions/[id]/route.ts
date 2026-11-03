import { z } from "zod";
import { getCurrentUser, isActive } from "@/lib/server/authz";
import { cancelAction, confirmAction } from "@/lib/server/assistant-actions";

/** Confirmar o cancelar una acción preparada por Alexia (solo la persona que la pidió). */
export async function POST(req: Request, ctx: RouteContext<"/api/assistant/actions/[id]">) {
  const u = await getCurrentUser();
  if (!u || !isActive(u)) return Response.json({ error: "Sesión no válida" }, { status: 401 });
  if (u.viewAs) return Response.json({ error: "En vista previa no se pueden hacer acciones." }, { status: 403 });
  const { id } = await ctx.params;
  const body = z.object({ decision: z.enum(["confirm", "cancel"]) }).safeParse(await req.json().catch(() => null));
  if (!body.success || !z.string().uuid().safeParse(id).success) return Response.json({ error: "Petición no válida" }, { status: 400 });
  const res = body.data.decision === "confirm" ? await confirmAction(u, id) : await cancelAction(u, id);
  return Response.json(res, { status: res.ok ? 200 : 409 });
}
