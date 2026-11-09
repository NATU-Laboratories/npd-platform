import { NextResponse } from "next/server";
import { runJobs } from "@/lib/server/jobs";
import { logError } from "@/lib/server/errors";
import { runWatchdog } from "@/lib/server/watchdog";

export const maxDuration = 60;

/** Revisión diaria (Vercel Cron): avisos proactivos de Alexia y reintentos de la cola. Protegido con CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  try {
    // Avisos proactivos de Alexia primero: sus emails entran en la cola que se procesa a continuación
    // ?resumen=1 fuerza el resumen semanal (para probarlo un día que no sea lunes)
    const alerts = await runWatchdog({ forceWeekly: new URL(req.url).searchParams.get("resumen") === "1" });
    const result = await runJobs({ limit: 50 });
    return NextResponse.json({ ...result, alerts });
  } catch (err) {
    await logError("cron:jobs", err);
    return NextResponse.json({ error: "cron failed" }, { status: 500 });
  }
}
