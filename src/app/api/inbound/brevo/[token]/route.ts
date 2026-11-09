import { logError } from "@/lib/server/errors";
import { inboundTokenOk } from "@/lib/server/reply-address";
import { receive } from "../handle";

export const maxDuration = 60;

/**
 * Emails recibidos (webhook de entrada de Brevo): respuestas de proveedores a las peticiones de
 * presupuesto. La URL lleva una clave derivada de INBOUND_SECRET; además cada dirección de
 * respuesta va firmada.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!inboundTokenOk(token)) {
    // Queda registrado: suele ser un webhook conectado con otra INBOUND_SECRET (hay que volver a conectar)
    await logError("inbound:unauthorized", new Error("Llamada al webhook de entrada con una clave que no coincide"), { tokenPrefix: token.slice(0, 6) });
    return new Response("Unauthorized", { status: 401 });
  }
  return receive(req);
}
