import { cn, daysUntil, formatDate } from "@/lib/utils";

/** Fecha necesaria con semáforo (§7.1). */
export function NeededBySignal({ date, riskDays, status }: { date: string | null; riskDays: number; status: string }) {
  const d = daysUntil(date);
  if (d === null) return <span className="text-slate-400">—</span>;
  const closed = !["submitted", "info_requested", "in_progress", "paused"].includes(status);
  const tone = closed ? "bg-slate-300" : d < 0 ? "bg-rose-500" : d <= riskDays ? "bg-amber-400" : "bg-emerald-500";
  const text = closed ? "" : d < 0 ? `vencida hace ${-d} d` : d === 0 ? "hoy" : `en ${d} d`;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={cn("size-2.5 rounded-full", tone)} aria-hidden />
      {formatDate(date)}
      {text && <span className={cn("text-xs", d < 0 ? "text-rose-600" : d <= riskDays ? "text-amber-700" : "text-slate-400")}>({text})</span>}
    </span>
  );
}

