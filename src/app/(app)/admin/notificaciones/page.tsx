import { desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { jobs, notificationLog, projects } from "@/db/schema";
import { PageTitle, Table, Td, Th } from "@/components/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resendNotificationAction, retryJobAction, sendTestEmailAction } from "@/app/actions/admin";
import { mailDriver, mailRedirect } from "@/lib/graph/mail";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Notificaciones" };

const TONE = { sent: "bg-[#eef0e6] text-[#56613f] ring-natu-sage", pending: "bg-slate-100 text-slate-700 ring-slate-200", failed: "bg-rose-50 text-rose-800 ring-rose-200" } as const;

export default async function NotificationsPage({ searchParams }: PageProps<"/admin/notificaciones">) {
  const { estado } = await searchParams;
  const [rows, queue] = await Promise.all([
    db
      .select({ n: notificationLog, code: projects.code })
      .from(notificationLog)
      .leftJoin(projects, eq(projects.id, notificationLog.projectId))
      .where(estado === "failed" || estado === "pending" || estado === "sent" ? eq(notificationLog.status, estado) : undefined)
      .orderBy(desc(notificationLog.createdAt))
      .limit(300),
    db.select().from(jobs).where(ne(jobs.status, "done")).orderBy(desc(jobs.createdAt)).limit(100),
  ]);
  return (
    <>
      <PageTitle title="Notificaciones" description="Registro de los emails de la plataforma con su estado, intentos y reenvío manual." />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <p className="text-slate-700">
          Envío:{" "}
          <strong className="font-semibold">
            {mailDriver() === "graph" ? "Microsoft 365 (Graph)" : mailDriver() === "smtp" ? `SMTP · ${process.env.MAIL_FROM || process.env.SMTP_USER}` : mailDriver() === "fail" ? "fallo simulado" : "desactivado (solo se registran)"}
          </strong>
          {mailRedirect().length > 0 && mailDriver() !== "log" && (
            <span className="mt-0.5 block text-xs text-amber-800">Modo pruebas: todos los emails se desvían a {mailRedirect().join(", ")}, indicando a quién iban.</span>
          )}
        </p>
        <form action={sendTestEmailAction}>
          <Button type="submit" variant="secondary" size="sm">
            Enviarme un email de prueba
          </Button>
        </form>
      </div>
      {queue.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold">Cola de trabajos pendientes / fallidos</h2>
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Tipo</Th>
                <Th>Estado</Th>
                <Th>Intentos</Th>
                <Th>Próximo intento</Th>
                <Th>Último error</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {queue.map((j) => (
                <tr key={j.id}>
                  <Td className="text-xs">{j.id}</Td>
                  <Td className="font-mono text-xs">{j.kind}</Td>
                  <Td className="text-xs">{j.status}</Td>
                  <Td className="text-xs">
                    {j.attempts}/{j.maxAttempts}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{formatDate(j.runAt, true)}</Td>
                  <Td className="max-w-xs truncate text-xs text-rose-700" >{j.lastError}</Td>
                  <Td>
                    <form action={retryJobAction}>
                      <input type="hidden" name="id" value={j.id} />
                      <Button size="sm" variant="secondary" type="submit">
                        Reintentar ahora
                      </Button>
                    </form>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <div className="mb-3 flex gap-2 text-sm">
        {[
          ["", "Todas"],
          ["failed", "Fallidas"],
          ["pending", "Pendientes"],
          ["sent", "Enviadas"],
        ].map(([v, l]) => (
          <a key={v} href={v ? `?estado=${v}` : "?"} className={`rounded-full px-3 py-1 ring-1 ${(estado ?? "") === v ? "bg-slate-900 text-white ring-slate-900" : "bg-white ring-slate-200"}`}>
            {l}
          </a>
        ))}
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Fecha</Th>
            <Th>Evento</Th>
            <Th>Proyecto</Th>
            <Th>Asunto / destinatarios</Th>
            <Th>Estado</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ n, code }) => (
            <tr key={n.id}>
              <Td className="whitespace-nowrap text-xs">{formatDate(n.createdAt, true)}</Td>
              <Td className="font-mono text-xs">{n.event}</Td>
              <Td className="font-mono text-xs">{code}</Td>
              <Td>
                <p className="text-sm">{n.subject}</p>
                <p className="text-xs text-slate-500">{n.recipients.join(", ")}</p>
                {n.error && <p className="mt-1 text-xs text-rose-700">{n.error}</p>}
              </Td>
              <Td>
                <Badge className={TONE[n.status]}>{n.status}</Badge>
                <p className="mt-1 text-[11px] text-slate-400">
                  {n.attempts} intento{n.attempts === 1 ? "" : "s"}
                  {n.sentAt ? ` · ${formatDate(n.sentAt, true)}` : ""}
                </p>
              </Td>
              <Td className="whitespace-nowrap">
                <a href={`/api/admin/notifications/${n.id}`} target="_blank" rel="noreferrer" className="mr-2 text-xs font-medium text-brand-700 hover:underline">
                  Ver email
                </a>
                <form action={resendNotificationAction} className="inline">
                  <input type="hidden" name="id" value={n.id} />
                  <Button size="sm" variant="secondary" type="submit">
                    Reenviar
                  </Button>
                </form>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
