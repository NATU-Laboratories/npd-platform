import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { errorLog } from "@/db/schema";
import { PageTitle, Table, Td, Th } from "@/components/admin";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Logs de errores" };

export default async function ErrorsPage({ searchParams }: PageProps<"/admin/errores">) {
  const { source } = await searchParams;
  const rows = await db
    .select()
    .from(errorLog)
    .where(typeof source === "string" && source ? eq(errorLog.source, source) : undefined)
    .orderBy(desc(errorLog.createdAt))
    .limit(300);
  return (
    <>
      <PageTitle title="Logs de errores" description="Errores de aplicación, fallos de Graph (SharePoint/email) y reintentos de la cola." />
      <Table>
        <thead>
          <tr>
            <Th>Fecha</Th>
            <Th>Origen</Th>
            <Th>Nivel</Th>
            <Th>Mensaje</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap text-xs">{formatDate(e.createdAt, true)}</Td>
              <Td className="font-mono text-xs">
                <a href={`?source=${encodeURIComponent(e.source)}`} className="hover:underline">
                  {e.source}
                </a>
              </Td>
              <Td className={`text-xs ${e.level === "error" ? "text-rose-700" : "text-amber-700"}`}>{e.level}</Td>
              <Td>
                <details>
                  <summary className="cursor-pointer text-sm">{e.message}</summary>
                  {e.context && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify(e.context, null, 2)}</pre>}
                  {e.stack && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[11px] text-slate-500">{e.stack}</pre>}
                </details>
              </Td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <Td className="py-8 text-center text-slate-400">Sin errores registrados.</Td>
            </tr>
          )}
        </tbody>
      </Table>
    </>
  );
}
