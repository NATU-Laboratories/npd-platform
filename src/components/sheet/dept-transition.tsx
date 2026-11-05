"use client";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { transitionDeptAction } from "@/app/actions/sheet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import type { SampleView } from "@/lib/server/lab";
import { resolveFieldRef } from "@/lib/sheet/sections";
import { cn } from "@/lib/utils";
import { ScalarInput } from "./section-editor";

/** Laboratorio: muestras que pasan a evaluación, o elección de las aprobadas. */
export type LabMode = { mode: "evaluation" | "approve"; pending: SampleView[]; canSeeFormula: boolean };
type SampleDraft = { key: number; code: string; formula: string };
let seq = 0;
const newSample = (): SampleDraft => ({ key: ++seq, code: "", formula: "" });

type Target = { id: number; name: string; isFinal: boolean; promptFields: string[]; missing: string[] };

/** Botón + diálogo para avanzar o retroceder el subestado de un departamento. */
export function DeptTransition({
  projectId,
  departmentId,
  referenceId,
  deptName,
  direction,
  targets,
  initialValues,
  lab,
}: {
  projectId: string;
  departmentId: number;
  /** Referencia (si el departamento avanza por referencia). */
  referenceId?: number;
  deptName: string;
  direction: "forward" | "back";
  targets: Target[];
  /** Valores actuales de los campos que pide el destino («apartado.campo»). */
  initialValues: Record<string, unknown>;
  lab?: LabMode;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [targetId, setTargetId] = React.useState(targets[0]?.id ?? 0);
  const [comment, setComment] = React.useState("");
  const [values, setValues] = React.useState<Record<string, unknown>>(initialValues);
  const [busy, setBusy] = React.useState(false);
  const [samples, setSamples] = React.useState<SampleDraft[]>(() => [newSample()]);
  const [approved, setApproved] = React.useState<number[]>([]);
  const target = targets.find((t) => t.id === targetId) ?? targets[0];
  if (!target) return null;
  const forward = direction === "forward";

  const labEval = forward && lab?.mode === "evaluation";
  const labApprove = forward && lab?.mode === "approve" && lab.pending.length > 0;
  const filledSamples = samples.filter((x) => x.code.trim() || x.formula.trim());

  async function confirm() {
    let labData: { samples?: { code: string; formula?: string }[]; approvedIds?: number[] } | undefined;
    if (labEval) {
      if (!filledSamples.length) return toast.error("Añade al menos una muestra con su código de referencia");
      if (filledSamples.some((x) => !x.code.trim())) return toast.error("Cada muestra necesita su código de referencia");
      labData = { samples: filledSamples.map((x) => ({ code: x.code.trim(), ...(lab!.canSeeFormula ? { formula: x.formula.trim() } : {}) })) };
    }
    if (labApprove) {
      if (!approved.length) return toast.error("Marca la muestra o muestras aprobadas");
      labData = { approvedIds: approved };
    }
    setBusy(true);
    const promptValues = forward ? Object.fromEntries(target!.promptFields.map((ref) => [ref, values[ref]])) : undefined;
    const res = await transitionDeptAction(projectId, departmentId, target!.id, comment, promptValues, referenceId, labData);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(res.data?.completed ? `${deptName}: completado` : `${deptName}: ${target!.name}`);
    setOpen(false);
    setComment("");
    setSamples([newSample()]);
    setApproved([]);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setValues(initialValues);
      }}
    >
      <DialogTrigger asChild>
        {forward ? (
          <Button size="sm">
            {target.isFinal ? <CheckCircle2 /> : <ArrowRight />} {target.isFinal ? `Completar: ${target.name}` : `Avanzar a «${target.name}»`}
          </Button>
        ) : (
          <Button size="sm" variant="ghost">
            <ArrowLeft /> Retroceder
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        wide={labEval}
        title={forward ? `${deptName} → «${target.name}»` : `${deptName}: volver a un estado anterior`}
        description={
          forward
            ? target.isFinal
              ? "Es el estado final: la parte del departamento queda completada."
              : "Se registrará en la actividad y se avisará al solicitante y a Marketing."
            : "Se abrirá una nueva ronda de trabajo. Se registrará en la actividad y se avisará."
        }
      >
        <div className="flex flex-col gap-4">
          {labEval && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-slate-700">
                Muestras que pasan a evaluación <span className="text-rose-600">*</span>
              </legend>
              {samples.map((x, i) => (
                <div key={x.key} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-start">
                  <Input
                    value={x.code}
                    onChange={(e) => setSamples((l) => l.map((y) => (y.key === x.key ? { ...y, code: e.target.value } : y)))}
                    placeholder="Cód. referencia…"
                    aria-label={`Código de referencia de la muestra ${i + 1}`}
                    maxLength={80}
                    spellCheck={false}
                    autoComplete="off"
                    className="sm:w-44"
                  />
                  {lab!.canSeeFormula && (
                    <Textarea
                      value={x.formula}
                      onChange={(e) => setSamples((l) => l.map((y) => (y.key === x.key ? { ...y, formula: e.target.value } : y)))}
                      placeholder="Fórmula…"
                      aria-label={`Fórmula de la muestra ${i + 1}`}
                      maxLength={2000}
                      rows={2}
                      className="min-h-10 flex-1"
                    />
                  )}
                  {samples.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setSamples((l) => l.filter((y) => y.key !== x.key))}
                      className="self-end rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:self-center"
                      aria-label={`Quitar la muestra ${i + 1}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              ))}
              <Button variant="secondary" size="sm" className="self-start" onClick={() => setSamples((l) => [...l, newSample()])}>
                <Plus aria-hidden /> Añadir ref.
              </Button>
              <p className="flex items-center gap-1 text-xs text-slate-500">
                <Lock className="size-3" aria-hidden /> La fórmula solo la ven Laboratorio, Calidad y administración.
              </p>
            </fieldset>
          )}
          {labApprove && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-slate-700">
                ¿Qué muestras se han aprobado? <span className="text-rose-600">*</span>
              </legend>
              {lab!.pending.map((x) => (
                <label
                  key={x.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-lg p-3 text-sm ring-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500",
                    approved.includes(x.id) ? "bg-[#eef0e6] ring-natu-sage" : "bg-white ring-slate-200 hover:bg-slate-50",
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-[#56613f]"
                    checked={approved.includes(x.id)}
                    onChange={(e) => setApproved((l) => (e.target.checked ? [...l, x.id] : l.filter((id) => id !== x.id)))}
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-slate-900">{x.code}</span>
                    <span className="ml-1 text-xs text-slate-500">· ronda {x.round}</span>
                    {lab!.canSeeFormula && x.formula && <span className="mt-0.5 block whitespace-pre-line text-xs text-slate-600">{x.formula}</span>}
                  </span>
                </label>
              ))}
              <p className="text-xs text-slate-500">Las que no marques quedan como no aprobadas. Los códigos aprobados se guardan como «Referencia aprobada» en la ficha.</p>
            </fieldset>
          )}
          {!forward && targets.length > 1 && (
            <Field label="Volver a" htmlFor="back-target">
              <Select id="back-target" value={targetId} onChange={(e) => setTargetId(Number(e.target.value))}>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {forward &&
            target.promptFields.map((ref) => {
              const r = resolveFieldRef(ref);
              if (!r) return null;
              const id = `prompt-${ref}`;
              return (
                <Field key={ref} label={r.field.label} hint={r.field.hint ?? "Opcional"} htmlFor={id}>
                  <ScalarInput f={r.field} id={id} value={values[ref]} onChange={(v) => setValues((x) => ({ ...x, [ref]: v }))} />
                </Field>
              );
            })}
          {forward && target.missing.length > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Para pasar a este estado falta: {target.missing.join("; ")}. Complétalo en «Ver detalles» → «Editar».
            </p>
          )}
          <Field label="Comentario" hint="Opcional" htmlFor="transition-comment">
            <Textarea id="transition-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={busy || (forward && target.missing.length > 0)}>
            {busy && <Loader2 className="animate-spin" />} Confirmar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
