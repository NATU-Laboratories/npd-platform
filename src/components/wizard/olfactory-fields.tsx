"use client";
import { Plus, Trash2 } from "lucide-react";
import { ChipGroup, TagInput } from "@/components/ui/chips";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import type { Option } from "@/lib/catalog-defaults";
import { cn } from "@/lib/utils";

export type OlfactoryState = {
  families?: string[];
  top?: string[];
  heart?: string[];
  base?: string[];
  intensity?: number | string;
  duration?: string;
  inspirations?: { product: string; brand: string; likes: string }[];
  gender?: string;
  ageRange?: string;
  style?: string;
  seasonality?: string[];
  allergenFree?: string;
  vegan?: boolean;
  naturalPct?: number | string;
  certifications?: string[];
};

const asOptions = (xs: Option[]) => xs.map((o) => ({ value: o.label, label: o.label }));

/** Bloque olfativo reutilizable (§5 Paso 3). */
export function OlfactoryFields({
  value,
  onChange,
  families,
  notes,
  seasonality,
  certifications,
  highlight,
}: {
  value: OlfactoryState;
  onChange: (v: OlfactoryState) => void;
  families: Option[];
  notes: Option[];
  seasonality: Option[];
  certifications: Option[];
  highlight: (key: string) => boolean;
}) {
  const set = <K extends keyof OlfactoryState>(k: K, v: OlfactoryState[K]) => onChange({ ...value, [k]: v });
  const noteNames = notes.map((n) => n.label);
  const insp = value.inspirations ?? [];

  return (
    <fieldset className="flex flex-col gap-5 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <legend className="px-2 text-sm font-semibold text-violet-900">Bloque olfativo</legend>

      <Field label="Familia(s) olfativa(s)" required highlight={highlight("olfactory.families")}>
        <ChipGroup options={asOptions(families)} value={value.families ?? []} onChange={(v) => set("families", v)} ariaLabel="Familias olfativas" />
      </Field>

      <div className={cn("grid gap-3 sm:grid-cols-3", highlight("olfactory.notes") && "field-highlight p-2")}>
        <Field label="Notas de salida" recommended>
          <TagInput value={value.top ?? []} onChange={(v) => set("top", v)} suggestions={noteNames} placeholder="p. ej. bergamota" chipClassName="bg-amber-50 text-amber-900 ring-amber-200" />
        </Field>
        <Field label="Notas de corazón" recommended>
          <TagInput value={value.heart ?? []} onChange={(v) => set("heart", v)} suggestions={noteNames} placeholder="p. ej. jazmín" chipClassName="bg-rose-50 text-rose-900 ring-rose-200" />
        </Field>
        <Field label="Notas de fondo" recommended>
          <TagInput value={value.base ?? []} onChange={(v) => set("base", v)} suggestions={noteNames} placeholder="p. ej. vainilla" chipClassName="bg-stone-100 text-stone-800 ring-stone-300" />
        </Field>
      </div>

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
            <div key={idx} className="grid gap-2 rounded-lg bg-white p-2 ring-1 ring-slate-200 sm:grid-cols-[1fr_1fr_2fr_auto]">
              <Input placeholder="Producto" value={i.product} onChange={(e) => set("inspirations", insp.map((x, j) => (j === idx ? { ...x, product: e.target.value } : x)))} aria-label="Producto de referencia" />
              <Input placeholder="Marca" value={i.brand} onChange={(e) => set("inspirations", insp.map((x, j) => (j === idx ? { ...x, brand: e.target.value } : x)))} aria-label="Marca de referencia" />
              <Input placeholder="Qué gusta de ella" value={i.likes} onChange={(e) => set("inspirations", insp.map((x, j) => (j === idx ? { ...x, likes: e.target.value } : x)))} aria-label="Qué gusta" />
              <Button type="button" variant="ghost" size="icon" aria-label="Quitar referencia" onClick={() => set("inspirations", insp.filter((_, j) => j !== idx))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => set("inspirations", [...insp, { product: "", brand: "", likes: "" }])}>
            <Plus /> Añadir referencia
          </Button>
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Género" recommended highlight={highlight("olfactory.gender")}>
          <Select value={value.gender ?? ""} onChange={(e) => set("gender", e.target.value || undefined)}>
            <option value="">—</option>
            <option value="femenino">Femenino</option>
            <option value="masculino">Masculino</option>
            <option value="unisex">Unisex</option>
          </Select>
        </Field>
        <Field label="Rango de edad">
          <Input value={value.ageRange ?? ""} onChange={(e) => set("ageRange", e.target.value)} placeholder="p. ej. 25-40" />
        </Field>
        <Field label="Estilo">
          <Input value={value.style ?? ""} onChange={(e) => set("style", e.target.value)} placeholder="p. ej. fresco, sofisticado" />
        </Field>
      </div>

      <Field label="Estacionalidad">
        <ChipGroup options={asOptions(seasonality)} value={value.seasonality ?? []} onChange={(v) => set("seasonality", v)} ariaLabel="Estacionalidad" />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Sin alérgenos concretos">
          <Input value={value.allergenFree ?? ""} onChange={(e) => set("allergenFree", e.target.value)} placeholder="p. ej. sin linalool" />
        </Field>
        <Field label="% natural">
          <Input type="number" inputMode="decimal" min={0} max={100} value={value.naturalPct ?? ""} onChange={(e) => set("naturalPct", e.target.value)} />
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox label="Vegano" checked={!!value.vegan} onChange={(e) => set("vegan", e.target.checked)} />
        </div>
      </div>
      <Field label="Certificaciones">
        <ChipGroup options={asOptions(certifications)} value={value.certifications ?? []} onChange={(v) => set("certifications", v)} ariaLabel="Certificaciones" />
      </Field>
    </fieldset>
  );
}
