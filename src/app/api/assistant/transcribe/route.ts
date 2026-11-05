import OpenAI from "openai";
import { getCurrentUser, isActive } from "@/lib/server/authz";
import { assistantEnabled } from "@/lib/server/assistant";
import { logError } from "@/lib/server/errors";
import { MAX_AUDIO_BYTES, transcribe } from "@/lib/server/voice";

export const maxDuration = 60;

/** Nota de voz → texto (la persona le habla a Alexia). */
export async function POST(req: Request) {
  const u = await getCurrentUser();
  if (!u || !isActive(u)) return Response.json({ error: "Sesión no válida" }, { status: 401 });
  if (!assistantEnabled()) return Response.json({ error: "El asistente no está configurado." }, { status: 503 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File) || !file.size) return Response.json({ error: "No ha llegado el audio." }, { status: 400 });
  if (file.size > MAX_AUDIO_BYTES) return Response.json({ error: "El audio es demasiado largo (máximo unos minutos)." }, { status: 413 });
  if (file.type && !file.type.startsWith("audio/") && file.type !== "video/webm") return Response.json({ error: "Formato de audio no válido." }, { status: 400 });
  try {
    const text = await transcribe(file);
    if (!text) return Response.json({ error: "No he entendido nada en el audio. ¿Lo repites?" }, { status: 422 });
    return Response.json({ text });
  } catch (err) {
    if (err instanceof OpenAI.RateLimitError) return Response.json({ error: "Muchas peticiones ahora mismo. Prueba en unos segundos." }, { status: 429 });
    await logError("assistant:transcribe", err, { userId: u.id, size: file.size, type: file.type });
    return Response.json({ error: "No he podido entender el audio. Inténtalo de nuevo o escríbelo." }, { status: 502 });
  }
}
