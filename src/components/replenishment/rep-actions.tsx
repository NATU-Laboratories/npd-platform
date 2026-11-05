"use client";
import { Eye, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { previewSupplierEmailsAction, replenishmentTransitionAction } from "@/app/actions/replenishments";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import type { RepAction, RepEmail } from "@/lib/server/replenishments";
import { cn } from "@/lib/utils";
import { CorrectionsEditor, newCorrection, type CorrectionDraft } from "./corrections-editor";
import { EmailPreview } from "./email-preview";

const META: Record<RepAction, { label: string; variant: "default" | "secondary" | "warning" | "danger"; hint: string; comment?: "required" | "optional" }> = {
  design_no_changes: { label: "Sin cambios: arte final listo", variant: "default", hint: "Confirmas que no hay cambios de diseño y que el arte final subido es el que se envía a imprenta. Pasa a Calidad.", comment: "optional" },
  design_changes: { label: "Hay cambios de diseño", variant: "warning", hint: "Indica qué cambia. Cuando subas el arte final corregido, lo enviarás a Calidad.", comment: "optional" },
  design_ready: { label: "Enviar arte final a Calidad", variant: "default", hint: "Confirmas que el arte final corregido de esta ronda está subido. Calidad lo validará.", comment: "optional" },
  quality_approved: { label: "Validar arte final", variant: "default", hint: "El arte final es correcto y se puede enviar a imprenta. Se avisará a Compras.", comment: "optional" },
  quality_reformulate: { label: "Reformular", variant: "warning", hint: "El producto necesita reformularse: se activa Laboratorio / I+D dentro de la reposición, con sus estados (desarrollo de muestras, evaluación, referencia aprobada). Cuando termine, volverá a Calidad.", comment: "required" },
  lab_reformulated: { label: "Reformulación terminada", variant: "default", hint: "Devuelve la reposición a Calidad para que vuelva a validar. Indica qué se ha cambiado (código de la nueva referencia, ingredientes que cambian en etiqueta…).", comment: "required" },
  quality_corrections: { label: "Pedir correcciones", variant: "warning", hint: "Vuelve a Diseño con una nueva ronda. Añade cada corrección con su indicación y, si ayuda, capturas." },
  sent_to_print: { label: "Marcar como enviado a imprenta", variant: "default", hint: "El arte final aprobado se ha enviado al proveedor / imprenta.", comment: "optional" },
  close: { label: "Cerrar (material recibido)", variant: "secondary", hint: "La reposición ha terminado.", comment: "optional" },
  cancel: { label: "Cancelar reposición", variant: "danger", hint: "Se avisará a los departamentos implicados.", comment: "required" },
};

const COMMENT_LABEL: Partial<Record<RepAction, string>> = {
  cancel: "Motivo",
  quality_reformulate: "Comentarios de reformulación",
  lab_reformulated: "Qué se ha reformulado",
};

const PRINT_MESSAGE = "El arte final está aprobado. Podéis proceder con la impresión según la cotización acordada. Os enviamos los archivos del arte final por separado.\n\nGracias.";

export function RepActions({ id, actions }: { id: string; actions: RepAction[] }) {
  const [open, setOpen] = React.useState<RepAction | null>(null);
  if (!actions.length) return null;
  const main = actions.filter((a) => a !== "cancel");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {main.map((a) => (
        <Button key={a} variant={META[a].variant} onClick={() => setOpen(a)}>
          {META[a].label}
        </Button>
      ))}
      {actions.includes("cancel") && (
        <button type="button" onClick={() => setOpen("cancel")} className="ml-auto text-xs text-slate-500 underline-offset-2 hover:text-rose-700 hover:underline">
          Cancelar reposición
        </button>
      )}
      {open && <ActionDialog id={id} action={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ActionDialog({ id, action, onClose }: { id: string; action: RepAction; onClose: () => void }) {
  const router = useRouter();
  const m = META[action];
  const [comment, setComment] = React.useState("");
  const [corrections, setCorrections] = React.useState<CorrectionDraft[]>(() => [newCorrection()]);
  const isCorrections = action === "quality_corrections";
  const [sendSupplier, setSendSupplier] = React.useState<boolean | null>(action === "sent_to_print" ? null : false);
  const [message, setMessage] = React.useState(PRINT_MESSAGE);
  const [preview, setPreview] = React.useState<{ key: string; emails: RepEmail[] } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const isPrint = action === "sent_to_print";
  const fresh = !isPrint || sendSupplier === false || preview?.key === message;

  async function doPreview() {
    setBusy(true);
    const res = await previewSupplierEmailsAction(id, "print", null, message);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setPreview({ key: message, emails: res.data ?? [] });
  }
  async function confirm() {
    if (m.comment === "required" && !comment.trim())
      return toast.error(action === "cancel" ? "Indica el motivo" : action === "quality_reformulate" ? "Explica qué hay que reformular" : action === "lab_reformulated" ? "Indica qué se ha reformulado" : "Explica qué hay que corregir");
    if (isCorrections) {
      if (corrections.some((c) => c.images.some((i) => i.uploading))) return toast.error("Espera a que terminen de subirse las capturas");
      const filled = corrections.filter((c) => c.text.trim() || c.images.length);
      if (!filled.length) return toast.error("Añade al menos una corrección");
      if (filled.some((c) => !c.text.trim())) return toast.error("Cada corrección necesita una indicación de qué hay que cambiar");
    }
    if (isPrint && sendSupplier === null) return toast.error("Indica si quieres avisar al proveedor por email");
    setBusy(true);
    const res = await replenishmentTransitionAction(id, action, {
      comment,
      sendSupplierEmails: !!sendSupplier,
      supplierMessage: message,
      ...(isCorrections
        ? { corrections: corrections.filter((c) => c.text.trim() || c.images.length).map((c) => ({ text: c.text.trim(), fileIds: c.images.flatMap((i) => (i.fileId ? [i.fileId] : [])) })) }
        : {}),
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Hecho");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={m.label} description={m.hint} wide={isPrint || isCorrections}>
        <div className="flex flex-col gap-4">
          {isCorrections && <CorrectionsEditor repId={id} value={corrections} onChange={setCorrections} />}
          {m.comment && (
            <Field label={m.comment === "required" ? (COMMENT_LABEL[action] ?? "Qué hay que corregir") : "Comentario (opcional)"} required={m.comment === "required"} htmlFor="ra-comment">
              <Textarea id="ra-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000} autoFocus={typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches} />
            </Field>
          )}
          {isPrint && (
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">
                ¿Avisar al proveedor por email de que el arte final está aprobado? <span className="text-rose-600">*</span>
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  [true, "Sí, enviar email"],
                  [false, "No es necesario"],
                ].map(([v, l]) => (
                  <label
                    key={String(v)}
                    className={cn("cursor-pointer rounded-lg px-3 py-2 text-sm ring-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 has-[:focus-visible]:ring-offset-2", sendSupplier === v ? "bg-natu-dark text-white ring-natu-dark" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50")}
                  >
                    <input type="radio" className="sr-only" checked={sendSupplier === v} onChange={() => setSendSupplier(v as boolean)} />
                    {l as string}
                  </label>
                ))}
              </div>
              {sendSupplier && (
                <div className="mt-3 flex flex-col gap-3">
                  <Field label="Mensaje para el proveedor" hint="El email no adjunta archivos: envía el arte final por el canal habitual." htmlFor="ra-msg">
                    <Textarea id="ra-msg" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} className="min-h-24" />
                  </Field>
                  <Button variant="secondary" size="sm" onClick={doPreview} disabled={busy} className="self-start">
                    <Eye /> {preview ? "Actualizar vista previa" : "Revisar email"}
                  </Button>
                  {preview && <EmailPreview emails={preview.emails} />}
                </div>
              )}
            </fieldset>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Volver
            </Button>
            <Button variant={m.variant === "secondary" ? "default" : m.variant} onClick={confirm} disabled={busy || !fresh} title={!fresh ? "Revisa primero el email" : undefined}>
              {busy && <Loader2 className="animate-spin" />} Confirmar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
