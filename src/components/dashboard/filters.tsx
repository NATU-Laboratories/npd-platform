"use client";
import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Input, Select } from "@/components/ui/form";
import { CATEGORY_LABEL, PHASES, STATUS_GROUPS, STATUS_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

type Opt = { id: number | string; name: string };

export function Filters({ brands, departments, requesters }: { brands: Opt[]; departments: Opt[]; requesters: Opt[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = React.useState(sp.get("q") ?? "");

  const setParam = React.useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      next.delete("page");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [sp, router, pathname],
  );

  React.useEffect(() => {
    if (q === (sp.get("q") ?? "")) return;
    const t = setTimeout(() => setParam({ q: q || null }), 300);
    return () => clearTimeout(t);
  }, [q, sp, setParam]);

  const sel = (key: string, label: string, options: [string, string][]) => (
    <Select aria-label={label} value={sp.get(key) ?? ""} onChange={(e) => setParam({ [key]: e.target.value || null })} className={cn("h-8 w-auto text-xs", sp.get(key) && "border-brand-500 bg-brand-50")}>
      <option value="">{label}</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </Select>
  );

  const toggle = (key: string, label: string) => (
    <button
      type="button"
      aria-pressed={sp.get(key) === "1"}
      onClick={() => setParam({ [key]: sp.get(key) === "1" ? null : "1" })}
      className={cn(
        "h-8 whitespace-nowrap rounded-full px-3 text-xs font-medium ring-1",
        sp.get(key) === "1" ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50",
      )}
    >
      {label}
    </button>
  );

  const active = [...sp.keys()].filter((k) => !["sort", "dir", "page"].includes(k)).length > 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar código, nombre, cliente…" className="h-8 pl-8 text-xs" aria-label="Buscar" />
        </div>
        {toggle("action", "Requieren mi acción")}
        {toggle("mine", "Mis proyectos")}
        {toggle("risk", "Solo en riesgo")}
        {active && (
          <button type="button" onClick={() => router.replace(pathname)} className="inline-flex h-8 items-center gap-1 px-2 text-xs text-slate-500 hover:text-slate-800">
            <X className="size-3.5" /> Limpiar
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {sel("type", "Tipo", [
          ["PL", "Marca privada"],
          ["MP", "Marca propia"],
        ])}
        {sel("brand", "Marca", brands.map((b) => [String(b.id), b.name]))}
        {sel("category", "Categoría", Object.entries(CATEGORY_LABEL))}
        {sel("status", "Estado", [
          ...Object.entries(STATUS_GROUPS).map(([k, g]) => [`g:${k}`, `▸ ${g.label}`] as [string, string]),
          ...Object.entries(STATUS_LABEL).filter(([k]) => k !== "draft"),
        ])}
        {sel("phase", "Fase", PHASES.map((p) => [String(p.n), `${p.n} · ${p.name}`]))}
        {sel("requester", "Solicitante", requesters.map((r) => [String(r.id), r.name]))}
        {sel("department", "Departamento", departments.map((d) => [String(d.id), d.name]))}
        <label className="flex items-center gap-1 text-xs text-slate-500">
          Desde
          <Input type="date" className="h-8 w-auto text-xs" value={sp.get("from") ?? ""} onChange={(e) => setParam({ from: e.target.value || null })} />
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          Hasta
          <Input type="date" className="h-8 w-auto text-xs" value={sp.get("to") ?? ""} onChange={(e) => setParam({ to: e.target.value || null })} />
        </label>
      </div>
    </div>
  );
}
