import { NextResponse } from "next/server";
import { runJobs } from "@/lib/server/jobs";
import { logError } from "@/lib/server/errors";

export const maxDuration = 60;

/** Reintentos de la cola (Vercel Cron). Protegido con CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  try {
    const result = await runJobs({ limit: 50 });
    return NextResponse.json(result);
  } catch (err) {
    await logError("cron:jobs", err);
    return NextResponse.json({ error: "cron failed" }, { status: 500 });
  }
}
