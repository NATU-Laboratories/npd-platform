import { NextResponse } from "next/server";
import { getCurrentUser, isActive, isAdmin } from "@/lib/server/authz";
import { activityQuery } from "@/lib/server/admin-queries";

const esc = (v: unknown) => {
  const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Exportación CSV del registro de actividad (§8). Separador ";" para Excel ES. */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u || !isActive(u) || !isAdmin(u)) return new NextResponse("Forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const rows = await activityQuery(Object.fromEntries(sp.entries()), 50_000);
  const lines = [
    ["fecha", "usuario", "email", "accion", "entidad", "id_entidad", "proyecto", "detalle"].join(";"),
    ...rows.map((r) => [r.a.createdAt.toISOString(), r.actor, r.actorEmail, r.a.action, r.a.entity, r.a.entityId, r.code, r.a.diff].map(esc).join(";")),
  ];
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="actividad-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
