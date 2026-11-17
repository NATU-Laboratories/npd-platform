import { NextResponse } from "next/server";
import { runJobs } from "@/lib/server/jobs";
import { logError } from "@/lib/server/errors";
import { syncInbox } from "@/lib/server/inbox";
import { runWatchdog } from "@/lib/server/watchdog";

export const maxDuration = 60;

/** Revisión diaria (Vercel Cron): avisos proactivos de Alexia, buzón de la plataforma y reintentos de la cola. Protegido con CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  try {
    // Avisos proactivos de Alexia primero: sus emails entran en la cola que se procesa a continuación
    // ?resumen=1 fuerza el resumen semanal (para probarlo un día que no sea lunes)
    const alerts = await runWatchdog({ forceWeekly: new URL(req.url).searchParams.get("resumen") === "1" });
    // Buzón de la plataforma: renovar la suscripción de Graph y recoger respuestas de proveedores perdidas
    const inbox = await syncInbox().catch(async (err) => (await logError("cron:inbox", err), { error: true }));
    const result = await runJobs({ limit: 50 });
    return NextResponse.json({ ...result, alerts, inbox });
  } catch (err) {
    await logError("cron:jobs", err);
    return NextResponse.json({ error: "cron failed" }, { status: 500 });
  }
}
