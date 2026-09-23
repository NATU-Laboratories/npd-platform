"use client";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import type { Option } from "@/lib/catalog-defaults";

/** Chips seleccionables (multi o simple). Botones grandes: usables en móvil. */
export function ChipGroup({
  options,
  value,
  onChange,
  multiple = true,
  ariaLabel,
}: {
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  multiple?: boolean;
  ariaLabel?: string;
}) {
  const toggle = (v: string) => {
    if (!multiple) return onChange(value[0] === v ? [] : [v]);
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const active = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(o.value)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm ring-1 transition-colors",
              active ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Entrada de chips con autocompletado sobre un catálogo; admite valores libres. */
export function TagInput({
  value,
  onChange,
  suggestions,
  placeholder,
  id,
  chipClassName,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions: string[];
  placeholder?: string;
  id?: string;
  chipClassName?: string;
}) {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const listId = React.useId();
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const matches = React.useMemo(() => {
    const n = norm(q.trim());
    return suggestions.filter((s) => !value.includes(s) && (!n || norm(s).includes(n))).slice(0, 8);
  }, [q, suggestions, value]);

  const add = (v: string) => {
    const t = v.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setQ("");
    setActive(0);
  };

  return (
    <div className="relative">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1.5 shadow-sm focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
        {value.map((v) => (
          <span key={v} className={cn("inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-sm text-brand-800 ring-1 ring-brand-200", chipClassName)}>
            {v}
            <button type="button" aria-label={`Quitar ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="rounded-full hover:bg-brand-100">
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={q}
          placeholder={value.length ? "" : placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(open && matches[active] ? matches[active]! : q);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Escape") {
              setOpen(false);
            } else if (e.key === "Backspace" && !q && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          className="min-w-24 flex-1 border-0 bg-transparent p-0.5 text-sm outline-none focus:ring-0"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
        />
      </div>
      {open && matches.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {matches.map((m, i) => (
            <li
              key={m}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                add(m);
              }}
              className={cn("cursor-pointer px-3 py-1.5 text-sm", i === active ? "bg-brand-50 text-brand-800" : "text-slate-700")}
            >
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
