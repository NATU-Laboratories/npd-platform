import { after } from "next/server";
import { authenticate, handleActivity, teamsConfigured, type Activity } from "@/lib/teams/bot";

// La respuesta del asistente se envía después (Teams espera un 200 en pocos segundos)
export const maxDuration = 60;

/** Punto de conexión de mensajes del bot de Teams (Azure Bot → «Messaging endpoint»). */
export async function POST(req: Request) {
  if (!teamsConfigured()) return new Response("Bot de Teams no configurado", { status: 503 });
  const activity = (await req.json().catch(() => null)) as Activity | null;
  if (!activity?.type) return new Response("Actividad no válida", { status: 400 });
  if (!(await authenticate(req.headers.get("authorization"), activity))) return new Response("No autorizado", { status: 401 });
  after(() => handleActivity(activity));
  return new Response(null, { status: 200 });
}
