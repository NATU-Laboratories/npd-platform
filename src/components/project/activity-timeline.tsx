"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export type ActivityItem = {
  id: number;
  group: "comentarios" | "decisiones" | "info" | "ediciones" | "ficha" | "archivos" | "otros";
  actor: string;
  text: string;
  detail?: string | null;
  changes?: { field: string; from: string; to: string }[];
  at: string;
};

const GROUPS: [ActivityItem["group"] | "todo", string][] = [
  ["todo", "Todo"],
  ["decisiones", "Decisiones"],
  ["info", "Peticiones de info"],
  ["comentarios", "Comentarios"],
  ["ficha", "Departamentos"],
  ["ediciones", "Ediciones"],
  ["archivos", "Archivos"],
];

const DOT: Record<ActivityItem["group"], string> = {
  decisiones: "bg-brand-600",
  info: "bg-amber-500",
  comentarios: "bg-natu-salmon",
  ediciones: "bg-natu-peach",
  ficha: "bg-[#7f8f63]",
  archivos: "bg-slate-400",
  otros: "bg-slate-300",
};

/** Timeline único y filtrable de actividad (§7.2 punto 6). */
export function ActivityTimeline({ items }: { items: ActivityItem[] }) {
  const [filter, setFilter] = React.useState<ActivityItem["group"] | "todo">("todo");
  const [limit, setLimit] = React.useState(12);
  const all = filter === "todo" ? items : items.filter((i) => i.group === filter);
  const shown = all.slice(0, limit);
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar actividad">
        {GROUPS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            aria-pressed={filter === k}
            onClick={() => {
              setFilter(k);
              setLimit(12);
            }}
            className={cn("rounded-full px-2.5 py-1 text-xs ring-1", filter === k ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200")}
          >
            {l}
          </button>
        ))}
      </div>
      <ol className="relative ml-2 border-l border-slate-200">
        {shown.map((i) => (
          <li key={i.id} className="mb-4 ml-4">
            <span className={cn("absolute -left-[5px] mt-1.5 size-2.5 rounded-full ring-2 ring-white", DOT[i.group])} aria-hidden />
            <p className="text-sm text-slate-800">
              <span className="font-medium">{i.actor}</span> {i.text}
            </p>
            {i.detail && <p className="mt-1 whitespace-pre-line rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{i.detail}</p>}
            {i.changes && i.changes.length > 0 && (
              <ul className="mt-1 space-y-0.5 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {i.changes.map((c) => (
                  <li key={c.field}>
                    <span className="font-medium text-slate-700">{c.field}:</span> <span className="line-through decoration-rose-400">{c.from || "∅"}</span> →{" "}
                    <span className="text-[#56613f]">{c.to || "∅"}</span>
                  </li>
                ))}
              </ul>
            )}
            <time className="text-xs text-slate-400" dateTime={i.at}>
              {new Date(i.at).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" })}
            </time>
          </li>
        ))}
        {!shown.length && <li className="ml-4 text-sm text-slate-400">Sin actividad</li>}
      </ol>
      {all.length > shown.length && (
        <button type="button" onClick={() => setLimit((l) => l + 20)} className="ml-6 text-xs font-medium text-brand-600 hover:text-brand-800">
          Ver más ({all.length - shown.length})
        </button>
      )}
    </div>
  );
}
