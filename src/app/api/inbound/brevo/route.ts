import { inboundTokenOk } from "@/lib/server/reply-address";
import { receive } from "./handle";

export const maxDuration = 60;

/** Variante con la clave como parámetro (?token=…). La URL que se registra en Brevo es /api/inbound/brevo/<clave>. */
export async function POST(req: Request) {
  if (!inboundTokenOk(new URL(req.url).searchParams.get("token"))) return new Response("Unauthorized", { status: 401 });
  return receive(req);
}
