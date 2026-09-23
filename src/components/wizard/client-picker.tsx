"use client";
import { Building2, Plus, Search, X } from "lucide-react";
import * as React from "react";
import { searchClientsAction } from "@/app/actions/lookup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import type { Option } from "@/lib/catalog-defaults";

type ClientLite = { id: number; name: string; country: string | null };
type NewClient = { name: string; country?: string; contact?: string };

export function ClientPicker({
  id,
  value,
  selected,
  newClient,
  allowNew = true,
  countries,
  onSelect,
  onNewClient,
}: {
  id?: string;
  value?: number;
  selected: ClientLite | null;
  newClient?: NewClient;
  allowNew?: boolean;
  countries: Option[];
  onSelect: (c: ClientLite | null) => void;
  onNewClient: (c: NewClient | undefined) => void;
}) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<ClientLite[]>([]);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => setResults(await searchClientsAction(q)), 200);
    return () => clearTimeout(t);
  }, [q, open]);

  if (newClient) {
    return (
      <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-brand-800">Nuevo cliente</p>
          <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => onNewClient(undefined)}>
            Buscar existente
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input id={id} placeholder="Nombre *" value={newClient.name} onChange={(e) => onNewClient({ ...newClient, name: e.target.value })} aria-label="Nombre del cliente" />
          <select
            className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
            value={newClient.country ?? ""}
            onChange={(e) => onNewClient({ ...newClient, country: e.target.value || undefined })}
            aria-label="País del cliente"
          >
            <option value="">País…</option>
            {countries.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <Input placeholder="Contacto (nombre, email…)" value={newClient.contact ?? ""} onChange={(e) => onNewClient({ ...newClient, contact: e.target.value })} aria-label="Contacto del cliente" />
        </div>
      </div>
    );
  }

  if (value && selected) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
        <Building2 className="size-4 text-slate-400" />
        <span className="flex-1">
          {selected.name} {selected.country && <span className="text-slate-400">· {selected.country}</span>}
        </span>
        <button type="button" aria-label="Quitar cliente" onClick={() => onSelect(null)} className="rounded p-0.5 hover:bg-slate-100">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  const term = q.trim();
  const norm = (x: string) => x.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  const exact = term ? results.find((c) => norm(c.name) === norm(term)) : undefined;

  /** Confirma lo escrito: si coincide con un cliente existente lo selecciona; si no, lo da de alta como nuevo. */
  const commit = () => {
    if (!term) return;
    if (exact) onSelect(exact);
    else if (allowNew) onNewClient({ name: term });
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" />
        <Input
          id={id}
          className="pl-8"
          placeholder={allowNew ? "Busca un cliente o escribe el nombre de uno nuevo…" : "Buscar cliente…"}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() =>
            setTimeout(() => {
              setOpen(false);
              // Escribir un nombre y salir del campo también lo da de alta (o selecciona el existente)
              commit();
            }, 150)
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") setOpen(false);
          }}
          role="combobox"
          aria-expanded={open}
          autoComplete="off"
        />
      </div>
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg" role="listbox">
          {results.map((c) => (
            <li
              key={c.id}
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(c);
                setOpen(false);
              }}
              className="cursor-pointer px-3 py-1.5 text-sm hover:bg-brand-50"
            >
              {c.name} {c.country && <span className="text-slate-400">· {c.country}</span>}
            </li>
          ))}
        </ul>
      )}
      {allowNew && term && !exact && (
        <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={commit}>
          <Plus /> Dar de alta «{term}» como cliente nuevo
        </Button>
      )}
    </div>
  );
}
