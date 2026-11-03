import OpenAI from "openai";
import { z } from "zod";
import { getCurrentUser, isActive } from "@/lib/server/authz";
import { askAssistant, assistantEnabled } from "@/lib/server/assistant";
import { logError } from "@/lib/server/errors";

// Las respuestas con varias consultas pueden tardar: margen hasta el límite del plan
export const maxDuration = 60;

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) }))
    .min(1)
    .max(40),
});

/** Asistente virtual: solo consulta (no hace cambios) y solo ve lo que ve el usuario. */
export async function POST(req: Request) {
  const u = await getCurrentUser();
  if (!u || !isActive(u)) return Response.json({ error: "Sesión no válida" }, { status: 401 });
  if (!assistantEnabled()) return Response.json({ error: "El asistente no está configurado todavía (falta la clave de la API de OpenAI)." }, { status: 503 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.messages.at(-1)?.role !== "user") return Response.json({ error: "Mensaje no válido" }, { status: 400 });
  try {
    const { text, actions } = await askAssistant(u, parsed.data.messages);
    return Response.json({ text, actions });
  } catch (err) {
    if (err instanceof OpenAI.RateLimitError) return Response.json({ error: "El asistente está muy solicitado ahora mismo. Prueba en unos segundos." }, { status: 429 });
    if (err instanceof OpenAI.APIConnectionError) return Response.json({ error: "No se ha podido conectar con OpenAI. Inténtalo de nuevo en unos segundos." }, { status: 503 });
    if (err instanceof OpenAI.AuthenticationError) {
      await logError("assistant", err);
      return Response.json({ error: "La clave de la API de OpenAI no es válida." }, { status: 503 });
    }
    if (err instanceof OpenAI.NotFoundError) {
      await logError("assistant", err);
      return Response.json({ error: "El modelo configurado en OPENAI_MODEL no existe o tu cuenta no tiene acceso a él." }, { status: 503 });
    }
    await logError("assistant", err, { userId: u.id });
    return Response.json({ error: "No he podido responder. Inténtalo de nuevo." }, { status: 500 });
  }
}
