"use client";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { saveSheetSectionAction } from "@/app/actions/sheet";
import { Uploader, type UploadedFile } from "@/components/uploader";
import { Button } from "@/components/ui/button";
import { ChipGroup, TagInput } from "@/components/ui/chips";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { applicable, SECTION_BY_KEY, type ScalarField, type SheetCtx, type SheetData } from "@/lib/sheet/sections";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  top: "bg-[#f7e6db] text-[#6b4331] ring-natu-peach",
  heart: "bg-[#f3d4ce] text-[#6e3a31] ring-natu-salmon",
  base: "bg-slate-100 text-slate-800 ring-slate-300",
};

function ScalarInput({ f, value, onChange, id, suggestions }: { f: ScalarField; value: unknown; onChange: (v: unknown) => void; id: string; suggestions: string[] }) {
  switch (f.type) {
    case "textarea":
      return <Textarea id={id} rows={3} value={(value as string) ?? ""} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "money":
    case "number":
      return (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            min={0}
            step={f.type === "money" ? "0.01" : "1"}
            value={value == null ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            className="max-w-40"
          />
          {f.unit && <span className="text-sm text-slate-500">{f.unit}</span>}
        </div>
      );
    case "date":
      return <Input id={id} type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} className="max-w-48" />;
    case "bool":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input id={id} type="checkbox" className="size-4 accent-brand-600" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          Sí
        </label>
      );
    case "select":
      return (
        <Select id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">Selecciona…</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    case "multi":
      return <ChipGroup options={f.options} value={(value as string[]) ?? []} onChange={onChange} ariaLabel={f.label} />;
    case "tags":
      return <TagInput id={id} value={(value as string[]) ?? []} onChange={onChange} suggestions={suggestions} placeholder={f.placeholder} chipClassName={TONE[f.tone ?? ""]} />;
    default:
      return <Input id={id} value={(value as string) ?? ""} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Editor de un apartado de la ficha técnica (responsables del departamento). */
export function SectionEditor({
  projectId,
  sectionKey,
  title,
  ctx,
  initial,
  files,
  maxMb,
  noteSuggestions,
}: {
  projectId: string;
  sectionKey: string;
  title: string;
  ctx: SheetCtx;
  initial: SheetData;
  files: UploadedFile[];
  maxMb: number;
  noteSuggestions: string[];
}) {
  const section = SECTION_BY_KEY[sectionKey]!;
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<SheetData>(initial);
  const [busy, setBusy] = React.useState(false);
  const set = (k: string, v: unknown) => setData((d) => ({ ...d, [k]: v }));

  async function save() {
    setBusy(true);
    const res = await saveSheetSectionAction(projectId, sectionKey, data);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(res.data?.reopened ? "Guardado. Falta información obligatoria: el apartado vuelve a pendiente." : "Apartado guardado");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setData(initial);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Pencil /> Editar
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description={section.description} wide>
        <div className="flex flex-col gap-6">
          {section.groups.map((g, gi) => {
            const fields = applicable(g.fields, ctx);
            if (!fields.length) return null;
            return (
              <fieldset key={gi} className="flex flex-col gap-4">
                {g.title && <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{g.title}</legend>}
                <div className="grid gap-4 sm:grid-cols-2">
                  {fields.map((f) => {
                    const id = `sheet-${sectionKey}-${f.key}`;
                    if (f.type === "files") {
                      return (
                        <Field key={f.key} label={f.label} required={f.required} hint={f.hint} className="sm:col-span-2">
                          <Uploader
                            projectId={projectId}
                            phase={section.phase}
                            initial={files.filter((x) => x.tag === f.tag)}
                            maxMb={maxMb}
                            defaultTag={f.tag}
                            showTags={false}
                            compact
                            refreshOnUpload
                          />
                        </Field>
                      );
                    }
                    if (f.type === "list") {
                      const items = (Array.isArray(data[f.key]) ? data[f.key] : []) as SheetData[];
                      const setItem = (i: number, k: string, v: unknown) => set(f.key, items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
                      return (
                        <div key={f.key} className="flex flex-col gap-3 sm:col-span-2">
                          <p className="text-sm font-medium text-slate-700">
                            {f.label} {f.required && <span className="text-rose-600">*</span>}
                          </p>
                          {items.map((it, i) => (
                            <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <div className="mb-2 flex items-center justify-between">
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  {f.itemLabel} {i + 1}
                                </p>
                                <Button type="button" variant="ghost" size="icon" aria-label={`Quitar ${f.itemLabel.toLowerCase()} ${i + 1}`} onClick={() => set(f.key, items.filter((_, j) => j !== i))}>
                                  <Trash2 />
                                </Button>
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                {applicable(f.item, ctx).map((x) => (
                                  <Field
                                    key={x.key}
                                    label={x.label}
                                    required={x.required}
                                    htmlFor={`${id}-${i}-${x.key}`}
                                    className={cn((x.type === "textarea" || x.type === "tags") && "sm:col-span-2")}
                                  >
                                    <ScalarInput f={x} id={`${id}-${i}-${x.key}`} value={it[x.key]} onChange={(v) => setItem(i, x.key, v)} suggestions={noteSuggestions} />
                                  </Field>
                                ))}
                              </div>
                            </div>
                          ))}
                          <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => set(f.key, [...items, {}])}>
                            <Plus /> {f.addLabel}
                          </Button>
                          {f.requireSome && <p className="text-xs text-slate-500">{f.requireSome.label}.</p>}
                        </div>
                      );
                    }
                    return (
                      <Field
                        key={f.key}
                        label={f.label}
                        required={f.required}
                        hint={f.hint}
                        htmlFor={id}
                        className={cn((f.type === "textarea" || f.type === "multi") && "sm:col-span-2")}
                      >
                        <ScalarInput f={f} id={id} value={data[f.key]} onChange={(v) => set(f.key, v)} suggestions={noteSuggestions} />
                      </Field>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>
        <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Guardar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
