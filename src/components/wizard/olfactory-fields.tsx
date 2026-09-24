"use client";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import type * as React from "react";
import { ChipGroup } from "@/components/ui/chips";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import type { Option } from "@/lib/catalog-defaults";
import { cn } from "@/lib/utils";

type Inspiration = { product: string; brand: string; likes: string; url?: string };

export type OlfactoryState = {
  families?: string[];
  intensity?: number | string;
  duration?: string;
  inspirations?: Inspiration[];
  genders?: string[];
  blacklist?: string;
};

const asOptions = (xs: Option[]) => xs.map((o) => ({ value: o.label, label: o.label }));

const GENDER_OPTIONS = [
  { value: "mujer", label: "Mujer" },
  { value: "hombre", label: "Hombre" },
  { value: "unisex", label: "Unisex" },
];

/** Bloque olfativo reutilizable (§5 Paso 3). */
export function OlfactoryFields({
  value,
  onChange,
  families,
  highlight,
  errorFor,
  blacklistUpload,
  inspirationUpload,
}: {
  value: OlfactoryState;
  onChange: (v: OlfactoryState) => void;
  families: Option[];
  highlight: (key: string) => boolean;
  errorFor: (key: string) => string | undefined;
  blacklistUpload?: React.ReactNode;
  /** Subida de imágenes/documentos de las referencias de inspiración (varios archivos). */
  inspirationUpload?: React.ReactNode;
}) {
  const set = <K extends keyof OlfactoryState>(k: K, v: OlfactoryState[K]) => onChange({ ...value, [k]: v });
  const insp = value.inspirations ?? [];
  const setInsp = (idx: number, patch: Partial<Inspiration>) => set("inspirations", insp.map((x, j) => (j === idx ? { ...x, ...patch } : x)));

  return (
    <fieldset className="flex flex-col gap-5 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <legend className="px-2 text-sm font-semibold text-violet-900">Bloque olfativo</legend>

      <Field label="Familia(s) olfativa(s)" required error={errorFor("olfactory.families")} highlight={highlight("olfactory.families")}>
        <ChipGroup options={asOptions(families)} value={value.families ?? []} onChange={(v) => set("families", v)} ariaLabel="Familias olfativas" />
      </Field>

      <Field label="Género" required hint="Puedes elegir varios." error={errorFor("olfactory.genders")} highlight={highlight("olfactory.genders")}>
        <ChipGroup options={GENDER_OPTIONS} value={value.genders ?? []} onChange={(v) => set("genders", v)} ariaLabel="Género" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Intensidad" recommended highlight={highlight("olfactory.intensity")}>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Intensidad">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={Number(value.intensity) === n}
                onClick={() => set("intensity", Number(value.intensity) === n ? undefined : n)}
                className={cn(
                  "size-9 rounded-full text-sm font-medium ring-1",
                  Number(value.intensity) >= n ? "bg-violet-600 text-white ring-violet-600" : "bg-white text-slate-600 ring-slate-300",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Duración deseada">
          <Input value={value.duration ?? ""} onChange={(e) => set("duration", e.target.value)} placeholder="p. ej. 6-8 h en piel" />
        </Field>
      </div>

      <Field label="Referencias de inspiración" recommended highlight={highlight("olfactory.inspirations")}>
        <div className="flex flex-col gap-2">
          {insp.map((i, idx) => (
            <div key={idx} className="grid gap-2 rounded-lg bg-white p-2 ring-1 ring-slate-200 sm:grid-cols-[1fr_1fr_auto]">
              <Input placeholder="Producto" value={i.product} onChange={(e) => setInsp(idx, { product: e.target.value })} aria-label="Producto de referencia" />
              <Input placeholder="Marca" value={i.brand} onChange={(e) => setInsp(idx, { brand: e.target.value })} aria-label="Marca de referencia" />
              <Button type="button" variant="ghost" size="icon" aria-label="Quitar referencia" onClick={() => set("inspirations", insp.filter((_, j) => j !== idx))}>
                <Trash2 />
              </Button>
              <Input className="sm:col-span-3" placeholder="Qué gusta de ella" value={i.likes} onChange={(e) => setInsp(idx, { likes: e.target.value })} aria-label="Qué gusta" />
              <div className="flex items-center gap-2 sm:col-span-3">
                <Input
                  type="url"
                  inputMode="url"
                  placeholder="Enlace a Fragrantica (https://www.fragrantica.es/…)"
                  value={i.url ?? ""}
                  onChange={(e) => setInsp(idx, { url: e.target.value })}
                  aria-label="Enlace a Fragrantica"
                  aria-invalid={!!errorFor(`olfactory.inspirations.${idx}.url`)}
                />
                {i.url && /^https?:\/\//i.test(i.url) && (
                  <a href={i.url} target="_blank" rel="noreferrer" className="shrink-0 rounded p-1.5 text-brand-700 hover:bg-brand-50" aria-label="Abrir enlace">
                    <ExternalLink className="size-4" />
                  </a>
                )}
              </div>
              {errorFor(`olfactory.inspirations.${idx}.url`) && <p className="text-xs text-rose-600 sm:col-span-3">{errorFor(`olfactory.inspirations.${idx}.url`)}</p>}
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => set("inspirations", [...insp, { product: "", brand: "", likes: "", url: "" }])}>
            <Plus /> Añadir referencia
          </Button>
          {inspirationUpload && (
            <div className="mt-1">
              <p className="mb-1 text-xs text-slate-500">Imágenes o documentos de las referencias (puedes subir varios a la vez).</p>
              {inspirationUpload}
            </div>
          )}
        </div>
      </Field>

      <Field label="Blacklist" hint="Ingredientes o materias primas que no se pueden usar. Pega la lista o adjunta el documento del cliente (opcional).">
        <Textarea rows={3} value={value.blacklist ?? ""} onChange={(e) => set("blacklist", e.target.value)} placeholder="Pega aquí la lista…" aria-label="Blacklist" />
        {blacklistUpload}
      </Field>
    </fieldset>
  );
}
