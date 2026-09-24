import Link from "next/link";
import { Suspense } from "react";
import { ArrowDown, ArrowUp, ChevronRight, FileEdit } from "lucide-react";
import { MonthlyChart, PhaseFunnel } from "@/components/dashboard/charts";
import { DashboardKpis } from "@/components/dashboard/kpis";
import { Filters } from "@/components/dashboard/filters";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireUser } from "@/lib/server/authz";
import { dashboardStats, filterOptions, listProjects, myDrafts, PAGE_SIZE, type ProjectFilters } from "@/lib/server/dashboard";
import { getSettings } from "@/lib/server/settings";
import { CATEGORY_LABEL, PHASES, PRIORITY_COLOR, PRIORITY_LABEL, stageOf } from "@/lib/labels";
import { cn, formatDate } from "@/lib/utils";
import { NeededBySignal } from "@/components/needed-by";

export const metadata = { title: "Panel" };

function sortHref(f: ProjectFilters, key: string) {
  const sp = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
  const current = (f.sort ?? "requested") === key;
  sp.set("sort", key);
  sp.set("dir", current && f.dir !== "asc" ? "asc" : "desc");
  sp.delete("page");
  return `/?${sp.toString()}`;
}

function SortTh({ f, k, children, className }: { f: ProjectFilters; k: string; children: React.ReactNode; className?: string }) {
  const current = (f.sort ?? "requested") === k;
  return (
    <th className={cn("px-3 py-2 font-medium", className)} aria-sort={current ? (f.dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={sortHref(f, k)} className="inline-flex items-center gap-1 hover:text-slate-900" scroll={false}>
        {children}
        {current && (f.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </Link>
    </th>
  );
}

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const u = await requireUser();
  const raw = await searchParams;
  const f: ProjectFilters = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const settings = await getSettings();
  const [list, stats, drafts, options] = await Promise.all([
    listProjects(u, f, settings.risk_days),
    dashboardStats(u, f, settings.risk_days),
    myDrafts(u),
    filterOptions(),
  ]);
  const t = stats.totals;

  const pageLink = (p: number) => {
    const sp = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    sp.set("page", String(p));
    return `/?${sp.toString()}`;
  };
  const pages = Math.ceil(list.total / PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Nuevos desarrollos</h1>
          <p className="text-sm text-slate-500">Hola, {u.name.split(" ")[0]}. Los indicadores reflejan los filtros activos.</p>
        </div>
      </div>

      {drafts.length > 0 && (
        <Card>
          <CardHeader title="Mis borradores" description="Solicitudes guardadas sin enviar (solo las ves tú)" />
          <ul className="divide-y divide-slate-100">
            {drafts.map((d) => (
              <li key={d.id}>
                <Link href={`/solicitudes/${d.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 sm:px-5">
                  <FileEdit className="size-4 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate font-medium">{d.name || "Sin nombre"}</span>
                  <span className="hidden text-xs text-slate-500 sm:inline">{d.type && d.category ? `${d.type} · ${CATEGORY_LABEL[d.category]}` : ""}</span>
                  <span className="text-xs text-slate-500">{d.completenessPct}%</span>
                  <span className="hidden text-xs text-slate-400 sm:inline">{formatDate(d.updatedAt, true)}</span>
                  <ChevronRight className="size-4 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Suspense>
        <Filters {...options} />
      </Suspense>

      <DashboardKpis
        total={t.total}
        bySituation={t.bySituation}
        atRisk={t.atRisk}
        riskDays={settings.risk_days}
        avgDaysToG1={t.avgDaysToG1}
        approvedG1={t.approvedG1}
        rejectedG1={t.rejectedG1}
      />

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Solicitudes por mes" description="Últimos 12 meses, por tipo" />
          <CardBody>
            <MonthlyChart data={stats.monthly} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Embudo por fase" description="Proyectos activos o cerrados" />
          <CardBody>
            <PhaseFunnel data={PHASES.map((p) => ({ name: `${p.n} · ${p.name}`, stage: stageOf(p.n).name, n: stats.byPhase.find((x) => x.phase === p.n)?.n ?? 0 }))} />
          </CardBody>
        </Card>
      </section>

      <Card>
        <CardHeader title="Proyectos" description={`${list.total} resultado${list.total === 1 ? "" : "s"}`} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <SortTh f={f} k="requested">Solicitud</SortTh>
                <SortTh f={f} k="name">Proyecto</SortTh>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <SortTh f={f} k="client">Cliente</SortTh>
                <SortTh f={f} k="needed">Entrega requerida</SortTh>
                <SortTh f={f} k="phase">Situación</SortTh>
                <th className="hidden px-3 py-2 font-medium lg:table-cell">Dptos.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.rows.map((p) => (
                <tr key={p.id} className="group relative hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{formatDate(p.requestedAt)}</td>
                  <td className="px-3 py-2.5">
                    {/* El enlace cubre toda la fila */}
                    <Link href={`/proyectos/${p.id}`} className="font-medium text-slate-900 after:absolute after:inset-0 group-hover:underline">
                      {p.name}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
                      <span className="font-mono">{p.code}</span>
                      <span>· {p.requesterName}</span>
                      {p.priority && (p.priority === "high" || p.priority === "urgent") && (
                        <span className={PRIORITY_COLOR[p.priority]}>· {PRIORITY_LABEL[p.priority]}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="whitespace-nowrap">{p.type === "MP" ? `MP · ${p.brandName ?? ""}` : (p.type ?? "—")}</div>
                    <div className="text-xs text-slate-500">{p.category ? CATEGORY_LABEL[p.category] : "—"}</div>
                  </td>
                  <td className="px-3 py-2.5">{p.clientName ?? <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2.5">
                    <NeededBySignal date={p.neededBy} riskDays={settings.risk_days} status={p.status} compact />
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={p.status} phase={p.phase} />
                    {p.status !== "in_production" && (
                      <div className="mt-0.5 whitespace-nowrap text-xs text-slate-500">
                        Fase {p.phase} · {PHASES[p.phase]?.short}
                      </div>
                    )}
                  </td>
                  <td className="hidden px-3 py-2.5 lg:table-cell">
                    {p.departments.length > 0 ? (
                      <span className="flex items-center gap-1" title={p.departments.map((d) => d.name).join(", ")}>
                        {p.departments.map((d) => (
                          <span key={d.name} className="size-2.5 rounded-full ring-1 ring-white" style={{ backgroundColor: d.color }} aria-hidden />
                        ))}
                        <span className="ml-1 text-xs text-slate-500">{p.departments.length}</span>
                        <span className="sr-only">{p.departments.map((d) => d.name).join(", ")}</span>
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!list.rows.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-500">
                    No hay proyectos con estos filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <nav className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2 text-sm" aria-label="Paginación">
            {list.page > 1 && <Link href={pageLink(list.page - 1)}>← Anterior</Link>}
            <span className="text-slate-500">
              Página {list.page} de {pages}
            </span>
            {list.page < pages && <Link href={pageLink(list.page + 1)}>Siguiente →</Link>}
          </nav>
        )}
      </Card>
    </div>
  );
}
