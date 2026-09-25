import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Row = { dept: { key: string; name: string; color: string }; steps: { id: number; name: string; isFinal: boolean; n: number }[] };

/** Proyectos activos por estado de cada departamento (según los filtros del panel). */
export function DeptBoard({ rows }: { rows: Row[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => r.steps.map((s) => s.n)));
  return (
    <Card>
      <CardHeader
        title="Departamentos · proyectos por estado"
        description="Proyectos activos (en curso o en pausa) que ya han llegado a la fase de cada departamento, según el estado en que está cada uno."
      />
      <CardBody className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const total = r.steps.reduce((a, s) => a + s.n, 0);
          return (
            <div key={r.dept.key}>
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <span className="size-2.5 rounded-full" style={{ background: r.dept.color }} aria-hidden />
                {r.dept.name}
                <span className="ml-auto text-xs font-normal text-slate-500">
                  {total} proyecto{total === 1 ? "" : "s"}
                </span>
              </p>
              <ol className="flex flex-col gap-1.5" aria-label={`Proyectos por estado en ${r.dept.name}`}>
                {r.steps.map((s) => (
                  <li key={s.id} className="grid grid-cols-[minmax(0,9rem)_1fr_1.5rem] items-center gap-2 text-xs" title={`${s.name}: ${s.n}`}>
                    <span className={cn("truncate", s.isFinal ? "text-[#56613f]" : "text-slate-600")}>{s.name}</span>
                    <span className="h-4 rounded bg-slate-100">
                      <span className={cn("block h-full rounded", s.isFinal ? "bg-[#7f8f63]" : "bg-brand-400")} style={{ width: `${s.n ? Math.max(4, (s.n / max) * 100) : 0}%` }} />
                    </span>
                    <span className="text-right font-semibold tabular-nums text-slate-900">{s.n}</span>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
