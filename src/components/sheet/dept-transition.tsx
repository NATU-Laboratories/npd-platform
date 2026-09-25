"use client";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { transitionDeptAction } from "@/app/actions/sheet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { resolveFieldRef } from "@/lib/sheet/sections";
import { ScalarInput } from "./section-editor";

type Target = { id: number; name: string; isFinal: boolean; promptFields: string[]; missing: string[] };

/** Botón + diálogo para avanzar o retroceder el subestado de un departamento. */
export function DeptTransition({
  projectId,
  departmentId,
  deptName,
  direction,
  targets,
  initialValues,
}: {
  projectId: string;
  departmentId: number;
  deptName: string;
  direction: "forward" | "back";
  targets: Target[];
  /** Valores actuales de los campos que pide el destino («apartado.campo»). */
  initialValues: Record<string, unknown>;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [targetId, setTargetId] = React.useState(targets[0]?.id ?? 0);
  const [comment, setComment] = React.useState("");
  const [values, setValues] = React.useState<Record<string, unknown>>(initialValues);
  const [busy, setBusy] = React.useState(false);
  const target = targets.find((t) => t.id === targetId) ?? targets[0];
  if (!target) return null;
  const forward = direction === "forward";

  async function confirm() {
    setBusy(true);
    const promptValues = forward ? Object.fromEntries(target!.promptFields.map((ref) => [ref, values[ref]])) : undefined;
    const res = await transitionDeptAction(projectId, departmentId, target!.id, comment, promptValues);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(res.data?.completed ? `${deptName}: completado` : `${deptName}: ${target!.name}`);
    setOpen(false);
    setComment("");
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
              Para pasar a este estado falta: {target.missing.join(" · ")}. Complétalo en «Ver detalles».
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
          <Button onClick={confirm} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Confirmar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
