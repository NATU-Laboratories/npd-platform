import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** Icono (i) con explicación al pasar el ratón o al enfocarlo con teclado. */
export function InfoTip({ text, className, align = "center", onDark = false }: { text: string; className?: string; align?: "center" | "end"; onDark?: boolean }) {
  return (
    <span className={cn("group/tip relative inline-flex align-middle", className)}>
      <button type="button" className={cn("rounded-full", onDark ? "text-white/60 hover:text-white focus-visible:text-white" : "text-slate-400 hover:text-slate-700 focus-visible:text-slate-700")} aria-label={text}>
        <Info className="size-3.5" aria-hidden />
      </button>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-full z-40 mt-2 w-64 rounded-md px-3 py-2 text-left text-xs leading-snug font-normal tracking-normal normal-case opacity-0 shadow-lg transition-opacity group-focus-within/tip:opacity-100 group-hover/tip:opacity-100",
          onDark ? "bg-white text-natu-dark ring-1 ring-slate-200" : "bg-natu-dark text-white",
          align === "end" ? "right-0" : "left-1/2 -translate-x-1/2",
        )}
      >
        {text}
      </span>
    </span>
  );
}

type Segment = { key: string; label: string; n: number; color: string; href: string; tip: string };

export type KpiData = {
  total: number;
  solicitados: number;
  enProceso: number;
  cerrados: number;
  rechazados: number;
  atRisk: number;
  riskDays: number;
  avgDaysToG1: number | null;
  approvedG1: number;
  rejectedG1: number;
};

/** Cabecera de indicadores del panel: cartera por estado, alertas y aprobación G1. */
export function DashboardKpis(k: KpiData) {
  const segments: Segment[] = [
    {
      key: "solicitados",
      label: "Solicitados",
      n: k.solicitados,
      color: "bg-natu-peach",
      href: "/?status=g:solicitados",
      tip: "Solicitudes enviadas que esperan la decisión G1, incluidas las que están pendientes de información del solicitante.",
    },
    {
      key: "en_proceso",
      label: "En proceso",
      n: k.enProceso,
      color: "bg-brand-400",
      href: "/?status=g:en_proceso",
      tip: "Aprobados en G1 y todavía abiertos: en validación (cotización y valoración con el cliente) o en curso (desarrollo → producción). Incluye los pausados.",
    },
    {
      key: "cerrados",
      label: "Cerrados",
      n: k.cerrados,
      color: "bg-natu-dark",
      href: "/?status=g:cerrados",
      tip: "Proyectos que han completado todas las fases y han pasado a producción.",
    },
    {
      key: "rechazados",
      label: "Rechazados",
      n: k.rechazados,
      color: "bg-slate-300",
      href: "/?status=g:rechazados",
      tip: "Proyectos rechazados (en G1 o por el cliente en G2) o cancelados.",
    },
  ];
  const decided = k.approvedG1 + k.rejectedG1;
  const rate = decided ? Math.round((k.approvedG1 / decided) * 100) : null;

  return (
    <section className="flex flex-col gap-2" aria-label="Indicadores">
      <div className="grid gap-3 lg:grid-cols-12">
        {/* Cartera por estado */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Cartera de proyectos
                <InfoTip text="Proyectos enviados que cumplen los filtros activos (no incluye borradores), repartidos por estado. Pulsa un estado para filtrar la tabla." />
              </h2>
              <p className="mt-1 text-4xl font-black tabular-nums text-natu-dark">{k.total}</p>
            </div>
          </div>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            {segments.map((s) => (s.n > 0 ? <span key={s.key} className={cn("h-full", s.color)} style={{ width: `${(s.n / Math.max(1, k.total)) * 100}%` }} /> : null))}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {segments.map((s) => (
              <div key={s.key} className="min-w-0">
                <dt className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className={cn("size-2 shrink-0 rounded-full", s.color)} aria-hidden />
                  <Link href={s.href} className="truncate hover:text-slate-900 hover:underline">
                    {s.label}
                  </Link>
                  <InfoTip text={s.tip} />
                </dt>
                <dd className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">{s.n}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Alerta de plazo */}
        <div
          className={cn(
            "flex flex-col justify-between rounded-xl border p-5 lg:col-span-2",
            k.atRisk > 0 ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white",
          )}
        >
          <div>
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              En riesgo
              <InfoTip text={`Proyectos abiertos cuya fecha necesaria vence en menos de ${k.riskDays} días o ya ha vencido. Pulsa para verlos.`} />
            </h2>
            <p className={cn("mt-1 flex items-center gap-2 text-4xl font-black tabular-nums", k.atRisk > 0 ? "text-brand-500" : "text-natu-dark")}>
              {k.atRisk > 0 ? <AlertTriangle className="size-7" aria-hidden /> : <CheckCircle2 className="size-7 text-emerald-600" aria-hidden />}
              {k.atRisk}
            </p>
          </div>
          {k.atRisk > 0 ? (
            <Link href="/?risk=1" className="group mt-3 inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:underline">
              Fecha necesaria en &lt; {k.riskDays} días
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          ) : (
            <p className="mt-3 text-xs text-slate-600">Todo en plazo</p>
          )}
        </div>

        {/* Rendimiento de la aprobación G1 */}
        <div className="rounded-xl border border-slate-200 bg-natu-dark p-5 text-white lg:col-span-4">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
            Aprobación de solicitudes · G1
            <InfoTip
              onDark
              text="G1 es la primera puerta de aprobación: decide si una solicitud es viable y pasa a Cotización. Estos datos miden la agilidad y el resultado de esa decisión."
            />
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <p className="flex items-center gap-1 text-xs text-white/70">
                Tiempo medio
                <InfoTip
                  onDark
                  text="Media de días entre el envío de la solicitud y su aprobación en G1."
                />
              </p>
              <p className="mt-1 text-3xl font-black tabular-nums">
                {k.avgDaysToG1 == null ? "—" : k.avgDaysToG1.toFixed(1)}
                {k.avgDaysToG1 != null && <span className="ml-1 text-base font-semibold text-white/70">días</span>}
              </p>
            </div>
            <div>
              <p className="flex items-center gap-1 text-xs text-white/70">
                Tasa de aprobación
                <InfoTip
                  align="end"
                  onDark
                  text="Porcentaje de solicitudes aprobadas sobre las ya decididas en G1 (aprobadas + rechazadas). Las pendientes no cuentan."
                />
              </p>
              <p className="mt-1 text-3xl font-black tabular-nums">{rate == null ? "—" : `${rate}%`}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15" aria-hidden>
                <span className="block h-full rounded-full bg-natu-salmon" style={{ width: `${rate ?? 0}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-white/60">
                {k.approvedG1} de {decided} decididas
              </p>
            </div>
          </div>
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-slate-500">
        <span className="font-semibold uppercase tracking-[0.14em] text-slate-400">Leyenda</span>
        <span>
          <b className="font-semibold text-slate-700">G1</b> · Aprobación de la solicitud (Solicitud → Cotización)
        </span>
        <span>
          <b className="font-semibold text-slate-700">G2</b> · Aprobación del presupuesto por el cliente (Valoración → Desarrollo)
        </span>
        <span>
          <b className="font-semibold text-slate-700">Validación</b> · Solicitud, cotización y valoración con cliente
        </span>
        <span>
          <b className="font-semibold text-slate-700">En curso</b> · Desarrollo, diseño y AAFF, preparación para producción
        </span>
      </p>
    </section>
  );
}
