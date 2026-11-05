import { z } from "zod";
import { getCurrentUser, isActive } from "@/lib/server/authz";
import { assistantEnabled } from "@/lib/server/assistant";
import { logError } from "@/lib/server/errors";
import { speak } from "@/lib/server/voice";

export const maxDuration = 60;

/** Respuesta de Alexia → audio (mp3) para escucharla. */
export async function POST(req: Request) {
  const u = await getCurrentUser();
  if (!u || !isActive(u)) return new Response("Sesión no válida", { status: 401 });
  if (!assistantEnabled()) return new Response("Asistente no configurado", { status: 503 });
  const body = z.object({ text: z.string().trim().min(1).max(6000) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return new Response("Texto no válido", { status: 400 });
  try {
    const audio = await speak(body.data.text);
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (err) {
    await logError("assistant:speech", err, { userId: u.id });
    return new Response("No se ha podido generar el audio", { status: 502 });
  }
}
