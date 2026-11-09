import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { PageTitle } from "@/components/admin";
import { Card } from "@/components/ui/card";
import { graphConfigured } from "@/lib/graph/client";
import { mailDriver, mailRedirect } from "@/lib/graph/mail";
import { sharepointBase, storageDriver } from "@/lib/graph/storage";
import { Button } from "@/components/ui/button";
import { migrateStorageAction } from "@/app/actions/admin";
import { migrationPending } from "@/lib/server/storage-migration";

export const metadata = { title: "Backoffice" };

export default async function AdminHome({ searchParams }: PageProps<"/admin">) {
  const { sharepoint: spMsg } = await searchParams;
  const sp = storageDriver() === "sharepoint" ? await sharepointStatus() : null;
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
              sp?.error ? (
                <span className="text-rose-700">SharePoint: {sp.error}</span>
              ) : (
                <>
                  SharePoint
                  {sp?.base && (
                    <>
                      {" · carpeta "}
                      {sp.base.webUrl ? (
                        <a href={sp.base.webUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 underline underline-offset-2">
                          {sp.base.name}
                        </a>
                      ) : (
                        <strong>{sp.base.name}</strong>
                      )}
                      {" (los proyectos van a la carpeta de su año: 2026, 2027…)"}
                    </>
                  )}
                </>
              )
            ) : (
              <span className="text-amber-700">{storageDriver() === "db" ? "base de datos (provisional, solo pruebas)" : "local (.storage) — solo desarrollo"}</span>
            )}
          </li>
          <li>
            Email:{" "}
            {mailDriver() === "graph" ? "Microsoft 365 (Graph)" : mailDriver() === "brevo" ? "Brevo (provisional)" : mailDriver() === "smtp" ? "SMTP (provisional)" : <span className="text-amber-700">no se envían emails reales; puedes verlos en Notificaciones</span>}
            {mailRedirect().length > 0 && mailDriver() !== "log" && <span className="text-amber-700"> · modo pruebas: todo va a {mailRedirect().join(", ")}</span>}
          </li>
        </ul>
        {sp && !sp.error && sp.pending && sp.pending.files + sp.pending.repFiles + sp.pending.projects > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-amber-900">
              Quedan en el almacenamiento provisional {sp.pending.files + sp.pending.repFiles} archivos y {sp.pending.projects} proyectos sin carpeta en SharePoint.
            </p>
            <form action={migrateStorageAction}>
              <Button type="submit" size="sm">
                Pasar a SharePoint
              </Button>
            </form>
          </div>
        )}
        {typeof spMsg === "string" && <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-slate-700">{spMsg}</p>}
      </Card>
    </>
  );
}

/** Carpeta base de SharePoint y lo que queda por pasar del almacenamiento provisional. */
async function sharepointStatus() {
  try {
    const [base, pending] = await Promise.all([sharepointBase(), migrationPending()]);
    return { base, pending, error: null as string | null };
  } catch (err) {
    return { base: null, pending: null, error: err instanceof Error ? err.message.slice(0, 200) : "no se pudo conectar" };
  }
}
