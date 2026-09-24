import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Info } from "lucide-react";
import { SITUATIONS, type SituationKey } from "@/lib/labels";
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

export type KpiData = {
  total: number;
  bySituation: Record<SituationKey, number>;
  atRisk: number;
  riskDays: number;
  avgDaysToG1: number | null;
  /** Días medios desde la aprobación del cliente (P2) hasta el paso a Preparación para producción. */
  avgDaysRunning: number | null;
  runningCount: number;
  p2Approved: number;
  p2Rejected: number;
};

/** Cabecera de indicadores del panel: cartera por situación, alertas y aprobación G1. */
export function DashboardKpis(k: KpiData) {
  const segments = SITUATIONS.map((x) => ({ ...x, n: k.bySituation[x.key] ?? 0, href: `/?status=${x.key}` }));
  const decided = k.p2Approved + k.p2Rejected;
  const rate = decided ? Math.round((k.p2Approved / decided) * 100) : null;
  const days = (v: number | null) => (
    <p className="mt-1 text-3xl font-black tabular-nums">
      {v == null ? "—" : v.toFixed(1)}
      {v != null && <span className="ml-1 text-base font-semibold text-white/70">días</span>}
    </p>
  );

  return (
    <section className="flex flex-col gap-2" aria-label="Indicadores">
      <div className="grid gap-3 lg:grid-cols-12">
        {/* Cartera por situación */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Cartera de proyectos
                <InfoTip text="Proyectos enviados que cumplen los filtros activos (no incluye borradores), repartidos por situación. Pulsa una situación para filtrar la tabla." />
              </h2>
              <p className="mt-1 text-4xl font-black tabular-nums text-natu-dark">{k.total}</p>
            </div>
          </div>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            {segments.map((s) => (s.n > 0 ? <span key={s.key} className={cn("h-full", s.color)} style={{ width: `${(s.n / Math.max(1, k.total)) * 100}%` }} /> : null))}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            {segments.map((s) => (
              <div key={s.key} className="min-w-0">
                <dt className="flex items-start gap-1.5 text-xs text-slate-500">
                  <span className={cn("mt-1 size-2 shrink-0 rounded-full", s.color)} aria-hidden />
                  <Link href={s.href} className="leading-tight hover:text-slate-900 hover:underline">
                    {s.label}
                  </Link>
                  <InfoTip text={s.hint} />
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
              <InfoTip text={`Proyectos abiertos cuya fecha de entrega requerida vence en menos de ${k.riskDays} días o ya ha vencido. Pulsa para verlos.`} />
            </h2>
            <p className={cn("mt-1 flex items-center gap-2 text-4xl font-black tabular-nums", k.atRisk > 0 ? "text-brand-500" : "text-natu-dark")}>
              {k.atRisk > 0 ? <AlertTriangle className="size-7" aria-hidden /> : <CheckCircle2 className="size-7 text-emerald-600" aria-hidden />}
              {k.atRisk}
            </p>
          </div>
          {k.atRisk > 0 ? (
            <Link href="/?risk=1" className="group mt-3 inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:underline">
              Entrega requerida en &lt; {k.riskDays} días
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          ) : (
            <p className="mt-3 text-xs text-slate-600">Todo en plazo</p>
          )}
        </div>

        {/* Tiempos y aprobación del cliente */}
        <div className="rounded-xl border border-slate-200 bg-natu-dark p-5 text-white lg:col-span-4">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
            Tiempos y aprobación
            <InfoTip onDark text="Agilidad del proceso (tiempo medio de P1 y de la etapa En curso) y resultado de la valoración del cliente (P2)." />
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-3">
              <div>
                <p className="flex items-center gap-1 text-xs text-white/70">
                  Tiempo medio P1
                  <InfoTip onDark text="Media de días entre el envío de la solicitud y su aprobación en P1." />
                </p>
                {days(k.avgDaysToG1)}
              </div>
              <div>
                <p className="flex items-center gap-1 text-xs text-white/70">
                  Tiempo medio En curso
                  <InfoTip
                    onDark
                    text="Media de días desde que el cliente aprueba el presupuesto (P2) hasta que el proyecto pasa a Preparación para producción. Solo cuenta los proyectos que ya han llegado a esa fase."
                  />
                </p>
                {days(k.avgDaysRunning)}
                <p className="text-[11px] text-white/60">
                  {k.runningCount} proyecto{k.runningCount === 1 ? "" : "s"} medido{k.runningCount === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <div>
              <p className="flex items-center gap-1 text-xs text-white/70">
                Aprobación del cliente · P2
                <InfoTip
                  align="end"
                  onDark
                  text="De los proyectos que pasaron P1 y cuyo presupuesto ya ha decidido el cliente, porcentaje aprobado (pasan a En curso). Los que siguen en cotización o valoración no cuentan."
                />
              </p>
              <p className="mt-1 text-3xl font-black tabular-nums">{rate == null ? "—" : `${rate}%`}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15" aria-hidden>
                <span className="block h-full rounded-full bg-natu-salmon" style={{ width: `${rate ?? 0}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-white/60">
                {k.p2Approved} de {decided} presupuesto{decided === 1 ? "" : "s"} decidido{decided === 1 ? "" : "s"} por el cliente
              </p>
            </div>
          </div>
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-slate-500">
        <span className="font-semibold uppercase tracking-[0.14em] text-slate-400">Leyenda</span>
        <span>
          <b className="font-semibold text-slate-700">P1</b> · Paso 1: aprobación de la solicitud (Solicitud → Cotización)
        </span>
        <span>
          <b className="font-semibold text-slate-700">P2</b> · Paso 2: aprobación del presupuesto por el cliente (Valoración → Desarrollo)
        </span>
        <span>
          <b className="font-semibold text-slate-700">Validación</b> · Solicitud, cotización y valoración con cliente
        </span>
        <span>
          <b className="font-semibold text-slate-700">En curso</b> · Desarrollo, diseño y AAFF, preparación para producción (tras P2)
        </span>
      </p>
    </section>
  );
}
