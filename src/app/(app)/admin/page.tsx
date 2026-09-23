import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { PageTitle } from "@/components/admin";
import { Card } from "@/components/ui/card";
import { graphConfigured } from "@/lib/graph/client";
import { mailDriver } from "@/lib/graph/mail";
import { storageDriver } from "@/lib/graph/storage";

export const metadata = { title: "Backoffice" };

export default async function AdminHome() {
  const { rows } = await db.execute<Record<string, number>>(sql`
    select
      (select count(*) from users where status = 'pending')::int as pending_users,
      (select count(*) from notification_log where status = 'failed')::int as failed_notifications,
      (select count(*) from jobs where status in ('pending','failed') and attempts > 0)::int as retrying_jobs,
      (select count(*) from error_log where created_at > now() - interval '24 hours')::int as errors_24h,
      (select count(*) from users where status = 'active')::int as active_users`);
  const s = rows[0]!;
  const cards = [
    ["Usuarios pendientes de activación", s.pending_users, "/admin/usuarios?estado=pending", s.pending_users > 0],
    ["Notificaciones fallidas", s.failed_notifications, "/admin/notificaciones?estado=failed", s.failed_notifications > 0],
    ["Trabajos en reintento", s.retrying_jobs, "/admin/notificaciones", s.retrying_jobs > 0],
    ["Errores (24 h)", s.errors_24h, "/admin/errores", s.errors_24h > 0],
    ["Usuarios activos", s.active_users, "/admin/usuarios", false],
  ] as const;
  return (
    <>
      <PageTitle title="Backoffice" description="Administración de la plataforma" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(([label, n, href, warn]) => (
          <Link key={label} href={href}>
            <Card className={`px-4 py-3 hover:border-brand-300 ${warn ? "border-amber-300 bg-amber-50" : ""}`}>
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-semibold">{n}</p>
            </Card>
          </Link>
        ))}
      </div>
      <Card className="mt-6 px-4 py-3 text-sm">
        <p className="font-medium">Integraciones</p>
        <ul className="mt-2 space-y-1 text-slate-600">
          <li>Microsoft Graph: {graphConfigured() ? "configurado" : <span className="text-amber-700">sin credenciales (modo local)</span>}</li>
          <li>
            Almacenamiento:{" "}
            {storageDriver() === "sharepoint" ? (
              "SharePoint"
            ) : (
              <span className="text-amber-700">{storageDriver() === "db" ? "base de datos (provisional, solo pruebas)" : "local (.storage) — solo desarrollo"}</span>
            )}
          </li>
          <li>Email: {mailDriver() === "graph" ? "Graph sendMail" : <span className="text-amber-700">no se envían emails reales; puedes verlos en Notificaciones</span>}</li>
        </ul>
      </Card>
    </>
  );
}
