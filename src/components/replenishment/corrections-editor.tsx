"use client";
import { ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { createRepUploadAction, registerRepFileAction } from "@/app/actions/replenishments";
import { Textarea } from "@/components/ui/form";
import { uploadChunks } from "@/components/uploader";

type Img = { key: string; preview: string; fileId?: number; uploading: boolean };
export type CorrectionDraft = { key: string; text: string; images: Img[] };

let seq = 0;
export const newCorrection = (): CorrectionDraft => ({ key: `c${seq++}`, text: "", images: [] });

/**
 * Correcciones de Calidad una a una: indicación + capturas (se pueden pegar con Ctrl+V
 * o elegir del equipo). Las capturas se suben a la reposición al añadirlas.
 */
export function CorrectionsEditor({ repId, value, onChange }: { repId: string; value: CorrectionDraft[]; onChange: React.Dispatch<React.SetStateAction<CorrectionDraft[]>> }) {
  // Siempre sobre el estado más reciente (las capturas terminan de subirse después)
  const update = (key: string, fn: (c: CorrectionDraft) => CorrectionDraft) => onChange((list) => list.map((c) => (c.key === key ? fn(c) : c)));

  async function addImages(key: string, files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith("image/")).slice(0, 10);
    if (!imgs.length) return;
    for (const file of imgs) {
      const img: Img = { key: `i${seq++}`, preview: URL.createObjectURL(file), uploading: true };
      update(key, (c) => ({ ...c, images: [...c.images, img] }));
      try {
        const name = file.name && file.name !== "image.png" ? file.name : `captura-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
        const s = await createRepUploadAction(repId, name, file.size);
        if (!s.ok) throw new Error(s.error);
        const item = await uploadChunks(s.data!.uploadUrl, file, () => {});
        const reg = await registerRepFileAction(repId, item.id, "correccion");
        if (!reg.ok) throw new Error(reg.error);
        update(key, (c) => ({ ...c, images: c.images.map((x) => (x.key === img.key ? { ...x, fileId: reg.data!.id, uploading: false } : x)) }));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo subir la captura");
        update(key, (c) => ({ ...c, images: c.images.filter((x) => x.key !== img.key) }));
      }
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {value.map((c, n) => (
        <div
          key={c.key}
          className="rounded-lg border border-slate-200 bg-white p-3"
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.some((f) => f.type.startsWith("image/"))) {
              e.preventDefault();
              void addImages(c.key, files);
            }
          }}
        >
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor={`corr-${c.key}`} className="text-sm font-medium text-slate-800">
              Corrección {n + 1}
            </label>
            {value.length > 1 && (
              <button type="button" onClick={() => onChange((list) => list.filter((x) => x.key !== c.key))} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Quitar la corrección ${n + 1}`}>
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
          <Textarea
            id={`corr-${c.key}`}
            value={c.text}
            onChange={(e) => update(c.key, (x) => ({ ...x, text: e.target.value }))}
            placeholder="Qué hay que corregir (p. ej. el lote debe ir en la cara trasera)…"
            maxLength={2000}
            className="min-h-16"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {c.images.map((img) => (
              <div key={img.key} className="relative size-16 overflow-hidden rounded-md ring-1 ring-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) */}
                <img src={img.preview} alt="Captura de la corrección" className="size-full object-cover" />
                {img.uploading ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-white/60">
                    <Loader2 className="size-4 animate-spin" aria-label="Subiendo" />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => update(c.key, (x) => ({ ...x, images: x.images.filter((i) => i.key !== img.key) }))}
                    className="absolute right-0.5 top-0.5 rounded-full bg-white/90 p-0.5 text-slate-600 hover:text-rose-600"
                    aria-label="Quitar captura"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            ))}
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-brand-600 ring-1 ring-slate-200 hover:bg-slate-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500">
              <ImagePlus className="size-4" aria-hidden /> Añadir captura
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  void addImages(c.key, [...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
            </label>
            <span className="text-[11px] text-slate-400">o pega una imagen con Ctrl+V</span>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange((list) => [...list, newCorrection()])} className="inline-flex items-center gap-1 self-start text-sm font-medium text-brand-600 hover:text-brand-800">
        <Plus className="size-4" aria-hidden /> Añadir corrección
      </button>
    </div>
  );
}
