"use client";
import { Loader2, Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { completeLabelInfoAction } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chips";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import type { Option } from "@/lib/catalog-defaults";

type RefValues = { id: number; title: string; finalName: string; facing: string };
type Values = { finalName: string; facing: string; languages: string[]; markets: string[]; refs: RefValues[] };

/**
 * El comercial completa los datos para la etiqueta tras aprobarse la fórmula.
 * Con varias referencias, naming y facing se piden para cada una; idiomas y países son comunes.
 */
export function LabelInfoDialog({
  projectId,
  initial,
  languages,
  markets,
}: {
  projectId: string;
  initial: Values;
  languages: Option[];
  markets: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState<Values>(initial);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = <K extends keyof Values>(k: K, x: Values[K]) => setV((s) => ({ ...s, [k]: x }));
  const setRef = (id: number, k: "finalName" | "facing", x: string) => setV((s) => ({ ...s, refs: s.refs.map((r) => (r.id === id ? { ...r, [k]: x } : r)) }));
  const multi = v.refs.length >= 2;

  async function save() {
    setBusy(true);
    setErrors({});
    const res = await completeLabelInfoAction(projectId, {
      finalName: v.finalName,
      facing: v.facing,
      languages: v.languages,
      markets: v.markets,
      ...(multi ? { refs: v.refs.map((r) => ({ id: r.id, finalName: r.finalName, facing: r.facing })) } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      return toast.error(res.error);
    }
    toast.success("Datos para la etiqueta guardados");
    setOpen(false);
    router.refresh();
  }

  const namesReady = multi ? v.refs.every((r) => r.finalName.trim() && r.facing.trim()) : v.finalName.trim() && v.facing.trim();
  const ready = namesReady && v.languages.length && v.markets.length;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setV(initial);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Tag /> Completar datos para la etiqueta
        </Button>
      </DialogTrigger>
      <DialogContent title="Datos para la etiqueta" description="El cliente ha aprobado la fórmula. Estos datos son necesarios para preparar la etiqueta y las artes finales." wide>
        <div className="flex flex-col gap-4">
          {multi ? (
            v.refs.map((r) => (
              <fieldset key={r.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3">
                <legend className="px-1 text-sm font-semibold text-slate-900">{r.title}</legend>
                <Field label="Naming definitivo" required htmlFor={`li-name-${r.id}`} error={errors[`ref.${r.id}.finalName`]}>
                  <Input id={`li-name-${r.id}`} value={r.finalName} onChange={(e) => setRef(r.id, "finalName", e.target.value)} placeholder="Nombre comercial con el que se venderá…" />
                </Field>
                <Field label="Facing" required htmlFor={`li-facing-${r.id}`} hint="Textos, claims y logos de la cara frontal." error={errors[`ref.${r.id}.facing`]}>
                  <Textarea id={`li-facing-${r.id}`} rows={2} value={r.facing} onChange={(e) => setRef(r.id, "facing", e.target.value)} />
                </Field>
              </fieldset>
            ))
          ) : (
            <>
              <Field label="Naming definitivo" required htmlFor="li-name" error={errors.finalName}>
                <Input id="li-name" value={v.finalName} onChange={(e) => set("finalName", e.target.value)} placeholder="Nombre comercial con el que se venderá…" />
              </Field>
              <Field label="Facing del producto" required htmlFor="li-facing" hint="Textos, claims y logos que deben ir en la cara frontal." error={errors.facing}>
                <Textarea id="li-facing" rows={3} value={v.facing} onChange={(e) => set("facing", e.target.value)} />
              </Field>
            </>
          )}
          <Field label={multi ? "Idiomas de etiquetado (todas las referencias)" : "Idiomas de etiquetado"} required error={errors.languages}>
            <ChipGroup options={languages} value={v.languages} onChange={(x) => set("languages", x)} ariaLabel="Idiomas de etiquetado" />
          </Field>
          <Field label={multi ? "Países de venta (todas las referencias)" : "Países de venta"} required error={errors.markets}>
            <ChipGroup options={markets} value={v.markets} onChange={(x) => set("markets", x)} ariaLabel="Países de venta" />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={busy || !ready}>
            {busy && <Loader2 className="animate-spin" />} Guardar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
