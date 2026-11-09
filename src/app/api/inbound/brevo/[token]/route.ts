import { inboundTokenOk } from "@/lib/server/reply-address";
import { receive } from "../handle";

export const maxDuration = 60;

/**
 * Emails recibidos (webhook de entrada de Brevo): respuestas de proveedores a las peticiones de
 * presupuesto. La URL lleva una clave derivada de INBOUND_SECRET; además cada dirección de
 * respuesta va firmada.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!inboundTokenOk((await params).token)) return new Response("Unauthorized", { status: 401 });
  return receive(req);
}
