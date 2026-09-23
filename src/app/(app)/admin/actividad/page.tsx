import { PageTitle, Table, Td, Th } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { activityQuery, type ActivityFilters } from "@/lib/server/admin-queries";
import { getActiveUsers } from "@/lib/server/catalogs";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Registro de actividad" };

export default async function ActivityPage({ searchParams }: PageProps<"/admin/actividad">) {
  const raw = await searchParams;
  const f: ActivityFilters = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && v)) as ActivityFilters;
  const [rows, people] = await Promise.all([activityQuery(f, 300), getActiveUsers()]);
  const qs = new URLSearchParams(f as Record<string, string>).toString();
  return (
    <>
      <PageTitle
        title="Registro de actividad"
        description="Quién hizo qué, cuándo y sobre qué entidad (últimos 300 según filtros)."
        actions={
          <Button asChild variant="secondary" size="sm">
            <a href={`/api/admin/activity?${qs}`}>Exportar CSV</a>
          </Button>
        }
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={f.q} placeholder="Código de proyecto o texto" className="h-8 w-56 text-xs" />
        <Select name="action" defaultValue={f.action ?? ""} className="h-8 w-auto text-xs">
          <option value="">Todas las acciones</option>
          {["project", "gate", "info", "comment", "file", "admin", "sharepoint"].map((a) => (
            <option key={a} value={a}>
              {a}.*
            </option>
          ))}
        </Select>
        <Select name="actor" defaultValue={f.actor ?? ""} className="h-8 w-auto text-xs">
          <option value="">Todos los usuarios</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Input type="date" name="from" defaultValue={f.from} className="h-8 w-auto text-xs" aria-label="Desde" />
        <Input type="date" name="to" defaultValue={f.to} className="h-8 w-auto text-xs" aria-label="Hasta" />
        <Button size="sm" type="submit">
          Filtrar
        </Button>
      </form>
      <Table>
        <thead>
          <tr>
            <Th>Fecha</Th>
            <Th>Usuario</Th>
            <Th>Acción</Th>
            <Th>Entidad</Th>
            <Th>Proyecto</Th>
            <Th>Detalle</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ a, actor, code }) => (
            <tr key={a.id}>
              <Td className="whitespace-nowrap text-xs">{formatDate(a.createdAt, true)}</Td>
              <Td className="whitespace-nowrap text-xs">{actor ?? "Sistema"}</Td>
              <Td className="font-mono text-xs">{a.action}</Td>
              <Td className="text-xs">
                {a.entity} {a.entityId && <span className="text-slate-400">#{a.entityId.slice(0, 12)}</span>}
              </Td>
              <Td className="font-mono text-xs">{code ?? ""}</Td>
              <Td className="max-w-md">
                {a.diff && <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all text-[11px] text-slate-600">{JSON.stringify(a.diff)}</pre>}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
