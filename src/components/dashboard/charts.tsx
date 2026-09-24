"use client";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Paleta categórica validada (orden fijo): PL = serie 1, MP = serie 2, MDD = serie 3.
export const SERIES = { pl: "#2a78d6", mp: "#eb6834", mdd: "#1baf7a", single: "#2a78d6" };
const AXIS = { fontSize: 11, fill: "#52514e" };
const GRID = "#e7e5e4";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

function TooltipBox({ active, payload, label, labelFmt }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; labelFmt?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-slate-900">{labelFmt ? labelFmt(String(label)) : label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-slate-600">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-semibold text-slate-900">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

export function MonthlyChart({ data }: { data: { month: string; pl: number; mp: number; mdd: number }[] }) {
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-slate-600" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: SERIES.pl }} /> Marca privada
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: SERIES.mp }} /> Marca propia
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: SERIES.mdd }} /> Marca de distribuidor
        </span>
      </div>
      <div className="h-56" role="img" aria-label="Evolución mensual de solicitudes por tipo, últimos 12 meses">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="month" tickFormatter={monthLabel} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
            <Tooltip content={<TooltipBox labelFmt={monthLabel} />} cursor={{ stroke: "#a8a29e", strokeDasharray: "3 3" }} />
            <Line type="monotone" dataKey="pl" name="Marca privada" stroke={SERIES.pl} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
            <Line type="monotone" dataKey="mp" name="Marca propia" stroke={SERIES.mp} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
            <Line type="monotone" dataKey="mdd" name="Marca de distribuidor" stroke={SERIES.mdd} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Barras horizontales de una sola serie con etiqueta directa del valor. */
export function HBarChart({ data, label }: { data: { name: string; n: number }[]; label: string }) {
  if (!data.length) return <p className="py-8 text-center text-sm text-slate-400">Sin datos</p>;
  const h = Math.max(120, data.length * 30 + 10);
  return (
    <div style={{ height: h }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 28, bottom: 0, left: 0 }} barCategoryGap={4}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={130} tick={AXIS} tickLine={false} axisLine={false} />
          <Tooltip content={<TooltipBox />} cursor={{ fill: "#f5f5f4" }} />
          <Bar dataKey="n" name="Proyectos" fill={SERIES.single} radius={[0, 4, 4, 0]} barSize={16} label={{ position: "right", fontSize: 11, fill: "#0b0b0b" }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Embudo por fase: barras centradas de ancho proporcional. */
export function PhaseFunnel({ data }: { data: { name: string; n: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <ol className="flex flex-col gap-1.5" aria-label="Embudo por fase">
      {data.map((d) => (
        <li key={d.name} className="grid grid-cols-[9rem_1fr_2rem] items-center gap-2 text-xs" title={`${d.name}: ${d.n}`}>
          <span className="truncate text-slate-600">{d.name}</span>
          <span className="flex justify-center">
            <span className="block h-5 rounded" style={{ width: `${Math.max(2, (d.n / max) * 100)}%`, background: SERIES.single }} />
          </span>
          <span className="text-right font-semibold text-slate-900">{d.n}</span>
        </li>
      ))}
    </ol>
  );
}
