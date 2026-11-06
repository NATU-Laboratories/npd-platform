"use client";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { saveSheetSectionAction } from "@/app/actions/sheet";
import { Uploader, type UploadedFile } from "@/components/uploader";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chips";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { applicable, forCtx, SECTION_BY_KEY, type RowColumn, type ScalarField, type SheetCtx, type SheetData } from "@/lib/sheet/sections";
import { cn } from "@/lib/utils";

/** Control de edición de un campo de la ficha (también se usa en el diálogo de cambio de subestado). */
export function ScalarInput({ f, value, onChange, id }: { f: ScalarField; value: unknown; onChange: (v: unknown) => void; id: string }) {
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
    case "url":
      return (
        <Input
          id={id}
          type="url"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          value={(value as string) ?? ""}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value.trim() || undefined)}
        />
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
    case "rows":
      return <RowsInput id={id} label={f.label} columns={f.columns} addLabel={f.addLabel} max={f.max ?? 10} value={value} onChange={onChange} />;
    default:
      return <Input id={id} value={(value as string) ?? ""} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Varias filas del mismo tipo (p. ej. más de una persona responsable). */
function RowsInput({
  id,
  label,
  columns,
  addLabel,
  max,
  value,
  onChange,
}: {
  id: string;
  label: string;
  columns: RowColumn[];
  addLabel: string;
  max: number;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const rows: Record<string, string>[] = Array.isArray(value) && value.length ? (value as Record<string, string>[]) : [{}];
  const setCell = (i: number, k: string, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="flex flex-col gap-2" id={id}>
      {rows.map((r, i) => (
        <div key={i} className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500">
              {label} {rows.length > 1 ? i + 1 : ""}
            </p>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                aria-label={`Quitar ${label.toLowerCase()} ${i + 1}`}
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {columns.map((c) => {
              const cid = `${id}-${i}-${c.key}`;
              return (
                <div key={c.key} className="flex flex-col gap-1">
                  <label htmlFor={cid} className="text-xs text-slate-600">
                    {c.label}
                  </label>
                  {c.options ? (
                    <Select id={cid} value={r[c.key] ?? ""} onChange={(e) => setCell(i, c.key, e.target.value)}>
                      <option value="">Selecciona…</option>
                      {c.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input id={cid} value={r[c.key] ?? ""} placeholder={c.placeholder} onChange={(e) => setCell(i, c.key, e.target.value)} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {rows.length < max && (
        <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => onChange([...rows, {}])}>
          <Plus aria-hidden /> {addLabel}
        </Button>
      )}
    </div>
  );
}

/** Editor de un apartado de la ficha técnica (miembros del departamento y gestor de proyectos). */
export function SectionEditor({
  projectId,
  sectionKey,
  referenceId,
  title,
  ctx,
  initial,
  files,
  maxMb,
  triggerLabel,
  required = [],
}: {
  /** Texto del botón que abre el editor (por defecto «Editar»). */
  triggerLabel?: string;
  /** Campos (claves) que faltan para avanzar: se marcan como obligatorios. */
  required?: string[];
  projectId: string;
  sectionKey: string;
  /** Referencia (apartados por referencia en proyectos con varias). */
  referenceId?: number;
  title: string;
  ctx: SheetCtx;
  initial: SheetData;
  files: UploadedFile[];
  maxMb: number;
}) {
  const section = SECTION_BY_KEY[sectionKey]!;
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<SheetData>(initial);
  const [busy, setBusy] = React.useState(false);
  const set = (k: string, v: unknown) => setData((d) => ({ ...d, [k]: v }));

  async function save() {
    setBusy(true);
    const res = await saveSheetSectionAction(projectId, sectionKey, data, referenceId);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Datos guardados");
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
        <Button variant={triggerLabel ? "warning" : "secondary"} size="sm">
          <Pencil aria-hidden /> {triggerLabel ?? "Editar"}
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description={section.description} wide>
        <div className="flex flex-col gap-6">
          {section.groups.map((g, gi) => {
            const fields = applicable(g.fields, ctx).map((f) => forCtx(f, ctx));
            if (!fields.length) return null;
            return (
              <fieldset key={gi} className="flex flex-col gap-4">
                {g.title && <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{g.title}</legend>}
                <div className="grid gap-4 sm:grid-cols-2">
                  {fields.map((f) => {
                    const id = `sheet-${sectionKey}-${f.key}`;
                    if (f.type === "files") {
                      return (
                        <Field key={f.key} label={f.label} hint={f.hint} className="sm:col-span-2">
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
                    return (
                      <Field
                        key={f.key}
                        label={f.label}
                        hint={f.hint}
                        htmlFor={id}
                        required={required.includes(f.key)}
                        highlight={required.includes(f.key)}
                        className={cn((f.type === "textarea" || f.type === "multi" || f.type === "rows") && "sm:col-span-2")}
                      >
                        <ScalarInput f={f} id={id} value={data[f.key]} onChange={(v) => set(f.key, v)} />
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
