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

type Values = { finalName: string; facing: string; languages: string[]; markets: string[] };

/** El comercial completa los datos para la etiqueta tras aprobarse la fórmula. */
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

  async function save() {
    setBusy(true);
    setErrors({});
    const res = await completeLabelInfoAction(projectId, v);
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      return toast.error(res.error);
    }
    toast.success("Datos para la etiqueta guardados");
    setOpen(false);
    router.refresh();
  }

  const ready = v.finalName.trim() && v.facing.trim() && v.languages.length && v.markets.length;
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
          <Field label="Naming definitivo" required htmlFor="li-name" error={errors.finalName}>
            <Input id="li-name" value={v.finalName} onChange={(e) => set("finalName", e.target.value)} placeholder="Nombre comercial con el que se venderá" />
          </Field>
          <Field label="Facing del producto" required htmlFor="li-facing" hint="Textos, claims y logos que deben ir en la cara frontal." error={errors.facing}>
            <Textarea id="li-facing" rows={3} value={v.facing} onChange={(e) => set("facing", e.target.value)} />
          </Field>
          <Field label="Idiomas de etiquetado" required error={errors.languages}>
            <ChipGroup options={languages} value={v.languages} onChange={(x) => set("languages", x)} ariaLabel="Idiomas de etiquetado" />
          </Field>
          <Field label="Países de venta" required error={errors.markets}>
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
