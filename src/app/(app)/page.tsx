import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronRight, FileEdit } from "lucide-react";
import { HBarChart, MonthlyChart, PhaseFunnel } from "@/components/dashboard/charts";
import { Filters } from "@/components/dashboard/filters";
import { DeptChip, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireUser } from "@/lib/server/authz";
import { dashboardStats, filterOptions, listProjects, myDrafts, PAGE_SIZE, type ProjectFilters } from "@/lib/server/dashboard";
import { getSettings } from "@/lib/server/settings";
import { CATEGORY_LABEL, PHASES, PRIORITY_COLOR, PRIORITY_LABEL, STATUS_LABEL } from "@/lib/labels";
import { cn, formatDate } from "@/lib/utils";
import { NeededBySignal } from "@/components/needed-by";

export const metadata = { title: "Panel" };

function Kpi({ label, value, hint, href, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string; tone?: "warn" }) {
  const body = (
    <Card className={cn("h-full px-4 py-3", href && "transition-colors hover:border-brand-300")}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums text-slate-900", tone === "warn" && "text-amber-700")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

function sortHref(f: ProjectFilters, key: string) {
  const sp = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
  const current = (f.sort ?? "requested") === key;
  sp.set("sort", key);
  sp.set("dir", current && f.dir !== "asc" ? "asc" : "desc");
  sp.delete("page");
  return `/?${sp.toString()}`;
}

function SortTh({ f, k, children }: { f: ProjectFilters; k: string; children: React.ReactNode }) {
  const current = (f.sort ?? "requested") === k;
  return (
    <th className="px-3 py-2 font-medium" aria-sort={current ? (f.dir === "asc" ? "ascending" : "descending") : undefined}>
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
  const decided = t.approvedG1 + t.rejectedG1;

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

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6" aria-label="Indicadores">
        <Kpi label="Proyectos" value={t.total} hint={`${t.pl} PL · ${t.mp} MP`} />
        <Kpi label="Solicitados" value={t.solicitados} href="/?status=g:solicitados" hint="Solicitado + pendiente de info" />
        <Kpi label="En proceso" value={t.enProceso} href="/?status=g:en_proceso" hint="En curso + en pausa" />
        <Kpi label="Cerrados" value={t.cerrados} href="/?status=g:cerrados" hint="En producción" />
        <Kpi label="Rechazados / cancelados" value={t.rechazados} href="/?status=g:rechazados" />
        <Kpi
          label="En riesgo"
          value={
            <span className="inline-flex items-center gap-1.5">
              {t.atRisk > 0 && <AlertTriangle className="size-5" />}
              {t.atRisk}
            </span>
          }
          hint={`Fecha necesaria < ${settings.risk_days} días`}
          href="/?risk=1"
          tone={t.atRisk > 0 ? "warn" : undefined}
        />
        <Kpi label="Tiempo medio hasta G1" value={t.avgDaysToG1 == null ? "—" : `${t.avgDaysToG1.toFixed(1)} d`} />
        <Kpi label="% aprobados en G1" value={decided ? `${Math.round((t.approvedG1 / decided) * 100)}%` : "—"} hint={`${t.approvedG1} de ${decided} decididos`} />
      </section>

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
            <PhaseFunnel data={PHASES.map((p) => ({ name: `${p.n} · ${p.name}`, n: stats.byPhase.find((x) => x.phase === p.n)?.n ?? 0 }))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Por estado" />
          <CardBody>
            <HBarChart label="Proyectos por estado" data={stats.byStatus.map((r) => ({ name: STATUS_LABEL[r.key as keyof typeof STATUS_LABEL] ?? r.key, n: r.n }))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Por tipo / marca" />
          <CardBody>
            <HBarChart label="Proyectos por tipo y marca" data={stats.byBrand.map((r) => ({ name: r.key, n: r.n }))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Por categoría y solicitante" />
          <CardBody className="flex flex-col gap-4">
            <HBarChart label="Proyectos por categoría" data={stats.byCategory.map((r) => ({ name: CATEGORY_LABEL[r.key as keyof typeof CATEGORY_LABEL] ?? r.key, n: r.n }))} />
            <HBarChart label="Proyectos por solicitante" data={stats.byRequester.slice(0, 6).map((r) => ({ name: r.key, n: r.n }))} />
          </CardBody>
        </Card>
      </section>

      <Card>
        <CardHeader title="Proyectos" description={`${list.total} resultado${list.total === 1 ? "" : "s"}`} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <SortTh f={f} k="code">Código</SortTh>
                <SortTh f={f} k="name">Nombre</SortTh>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Categoría</th>
                <SortTh f={f} k="client">Cliente</SortTh>
                <th className="px-3 py-2 font-medium">Solicitante</th>
                <SortTh f={f} k="requested">Solicitud</SortTh>
                <SortTh f={f} k="needed">Fecha necesaria</SortTh>
                <SortTh f={f} k="status">Estado</SortTh>
                <SortTh f={f} k="phase">Fase</SortTh>
                <th className="px-3 py-2 font-medium">Departamentos</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{p.code}</td>
                  <td className="max-w-64 px-3 py-2">
                    <Link href={`/proyectos/${p.id}`} className="font-medium text-slate-900 hover:underline">
                      {p.name}
                    </Link>
                    {p.priority && (p.priority === "high" || p.priority === "urgent") && (
                      <span className={cn("ml-1.5 text-xs", PRIORITY_COLOR[p.priority])}>· {PRIORITY_LABEL[p.priority]}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{p.type === "MP" ? `MP – ${p.brandName ?? ""}` : "PL"}</td>
                  <td className="px-3 py-2">{p.category ? CATEGORY_LABEL[p.category] : "—"}</td>
                  <td className="px-3 py-2">{p.clientName ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{p.requesterName}</td>
                  <td className="whitespace-nowrap px-3 py-2">{formatDate(p.requestedAt)}</td>
                  <td className="px-3 py-2">
                    <NeededBySignal date={p.neededBy} riskDays={settings.risk_days} status={p.status} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{PHASES[p.phase]?.name}</td>
                  <td className="px-3 py-2">
                    <div className="flex max-w-56 flex-wrap gap-1">
                      {p.departments.map((d) => (
                        <DeptChip key={d.name} {...d} />
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/proyectos/${p.id}`} className="whitespace-nowrap text-xs font-medium text-brand-700 hover:underline">
                      Ver detalle
                    </Link>
                  </td>
                </tr>
              ))}
              {!list.rows.length && (
                <tr>
                  <td colSpan={12} className="px-3 py-10 text-center text-sm text-slate-500">
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
