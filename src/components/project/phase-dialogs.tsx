"use client";
import { ArrowRight, CheckCircle2, Factory, Loader2, PauseCircle, RotateCcw, Send, Wallet, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { advancePhaseAction, decideBudgetAction, markPrepaymentAction, sendQuoteAction } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { Option } from "@/lib/catalog-defaults";
import { cn } from "@/lib/utils";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const run = async (fn: () => Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string> }>, success: string, close: () => void) => {
    setBusy(true);
    setErrors({});
    const r = await fn();
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      toast.error(r.error ?? "Error");
      return;
    }
    toast.success(success);
    close();
    router.refresh();
  };
  return { busy, errors, run };
}

// ─── Fase 1: enviar cotización ────────────────────────────────────────────

export function QuoteDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [comment, setComment] = React.useState("");
  const { busy, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Send /> Enviar cotización al cliente
        </Button>
      </DialogTrigger>
      <DialogContent title="Enviar cotización al cliente" description="El proyecto pasa a «Valoración con cliente». Adjunta el PDF de la cotización en Archivos (carpeta 01 Cotización).">
        <div className="flex flex-col gap-4">
          <Field label="Importe cotizado (€)" hint="Opcional">
            <Input type="number" inputMode="decimal" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Comentario" hint="Opcional: condiciones, validez, observaciones…">
            <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              run(
                () => sendQuoteAction(projectId, { amount: amount ? Number(amount.replace(",", ".")) : null, comment }),
                "Cotización registrada. El proyecto pasa a Valoración con cliente.",
                () => setOpen(false),
              )
            }
          >
            {busy && <Loader2 className="animate-spin" />} Confirmar envío
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Fase 2: G2 · aprobación del presupuesto ──────────────────────────────

type BudgetKind = "approve" | "changes" | "reject" | "pause";
const TABS: { k: BudgetKind; label: string; icon: React.ElementType; tone: string }[] = [
  { k: "approve", label: "Cliente aprueba", icon: CheckCircle2, tone: "text-emerald-700" },
  { k: "changes", label: "Pide cambios", icon: RotateCcw, tone: "text-amber-700" },
  { k: "reject", label: "Cliente rechaza", icon: XCircle, tone: "text-rose-700" },
  { k: "pause", label: "Pausar", icon: PauseCircle, tone: "text-slate-700" },
];

export function BudgetDialog({
  projectId,
  requiresPrepayment,
  currentUserName,
  quoteInfo,
  rejectionReasons,
}: {
  projectId: string;
  requiresPrepayment: boolean;
  currentUserName: string;
  quoteInfo: string | null;
  rejectionReasons: Option[];
}) {
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<BudgetKind>("approve");
  const [comment, setComment] = React.useState("");
  const [ppMode, setPpMode] = React.useState<"received" | "waived" | "">("");
  const [responsible, setResponsible] = React.useState(currentUserName);
  const [accepted, setAccepted] = React.useState(false);
  const [ppNote, setPpNote] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [reasonCode, setReasonCode] = React.useState("");
  const { busy, errors, run } = useAction();

  const approveReady = !requiresPrepayment || ppMode === "received" || (ppMode === "waived" && responsible.trim() && accepted);
  const disabled =
    busy ||
    (kind === "approve" && !approveReady) ||
    ((kind === "changes" || kind === "pause") && !reason.trim()) ||
    (kind === "reject" && (!reasonCode || (reasonCode === "otro" && !reason.trim())));

  const submit = () => {
    const decision =
      kind === "approve"
        ? {
            kind,
            comment,
            prepayment: requiresPrepayment && ppMode ? { mode: ppMode, responsible, accepted, note: ppNote } : null,
          }
        : kind === "reject"
          ? { kind, reasonCode, reasonText: reason }
          : { kind, reason };
    const msg = { approve: "Presupuesto aprobado. El proyecto pasa a En curso · Desarrollo.", changes: "El proyecto vuelve a Cotización.", reject: "Proyecto rechazado.", pause: "Proyecto en pausa." }[kind];
    return run(() => decideBudgetAction(projectId, decision as Parameters<typeof decideBudgetAction>[1]), msg, () => setOpen(false));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Registrar respuesta del cliente (G2)</Button>
      </DialogTrigger>
      <DialogContent title="G2 · Aprobación del presupuesto" description={quoteInfo ?? "Registra la respuesta del cliente a la cotización."} wide>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist">
          {TABS.map(({ k, label, icon: Icon, tone }) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium ring-1",
                kind === k ? "bg-slate-900 text-white ring-slate-900" : cn("bg-white ring-slate-200 hover:bg-slate-50", tone),
              )}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-4">
          {kind === "approve" && (
            <>
              {requiresPrepayment && (
                <fieldset className={cn("rounded-lg border p-4", errors.prepayment || errors.responsible || errors.accepted ? "border-rose-300" : "border-amber-300 bg-amber-50/50")}>
                  <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold text-amber-900">
                    <Wallet className="size-4" /> Anticipo del 30 % (marca privada)
                  </legend>
                  <p className="mb-3 text-xs text-amber-900">Para pasar el proyecto a desarrollo, el cliente debe haber abonado el 30 % por adelantado.</p>
                  <div className="flex flex-col gap-2">
                    <label className="flex cursor-pointer items-start gap-2 text-sm">
                      <input type="radio" name="pp" className="mt-1 accent-brand-600" checked={ppMode === "received"} onChange={() => setPpMode("received")} />
                      <span>
                        <span className="font-medium">Anticipo del 30 % recibido</span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 text-sm">
                      <input type="radio" name="pp" className="mt-1 accent-brand-600" checked={ppMode === "waived"} onChange={() => setPpMode("waived")} />
                      <span>
                        <span className="font-medium">Iniciar sin el anticipo</span>
                        <span className="block text-xs text-slate-600">Alguien debe asumir la responsabilidad de iniciar el proyecto sin el pago inicial.</span>
                      </span>
                    </label>
                  </div>
                  {ppMode === "waived" && (
                    <div className="mt-3 flex flex-col gap-3 rounded-md bg-white p-3 ring-1 ring-amber-200">
                      <Field label="Nombre del responsable" required error={errors.responsible}>
                        <Input value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder="Nombre y apellidos" />
                      </Field>
                      <Checkbox
                        label={`${responsible.trim() || "El responsable"} se hace responsable de que el proyecto se inicie sin el anticipo del 30 %.`}
                        checked={accepted}
                        onChange={(e) => setAccepted(e.target.checked)}
                      />
                      {errors.accepted && <p className="text-xs text-rose-600">{errors.accepted}</p>}
                    </div>
                  )}
                  {ppMode && (
                    <Field label="Nota sobre el pago" hint="Opcional: fecha, referencia de la transferencia, acuerdo…" className="mt-3">
                      <Input value={ppNote} onChange={(e) => setPpNote(e.target.value)} />
                    </Field>
                  )}
                  {errors.prepayment && <p className="mt-2 text-xs text-rose-600">{errors.prepayment}</p>}
                </fieldset>
              )}
              <Field label="Comentario" hint="Opcional">
                <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
              </Field>
            </>
          )}
          {kind === "changes" && (
            <Field label="¿Qué cambios pide el cliente?" required hint="El proyecto vuelve a la fase de Cotización.">
              <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          {kind === "reject" && (
            <>
              <Field label="Motivo" required>
                <Select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                  <option value="">Selecciona…</option>
                  {rejectionReasons.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Explicación" required={reasonCode === "otro"}>
                <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </>
          )}
          {kind === "pause" && (
            <Field label="Motivo de la pausa" required>
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button variant={kind === "reject" ? "danger" : kind === "changes" ? "warning" : "default"} onClick={submit} disabled={!!disabled}>
            {busy && <Loader2 className="animate-spin" />} Confirmar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Fases 3–6: avanzar ───────────────────────────────────────────────────

export function AdvanceDialog({
  projectId,
  nextLabel,
  toProduction,
  pendingSections = [],
}: {
  projectId: string;
  nextLabel: string;
  toProduction: boolean;
  /** Apartados de la ficha técnica sin terminar hasta la fase actual. */
  pendingSections?: string[];
}) {
  const [open, setOpen] = React.useState(false);
  const [comment, setComment] = React.useState("");
  const [force, setForce] = React.useState(false);
  const blocked = pendingSections.length > 0 && !force;
  const { busy, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          {toProduction ? <Factory /> : <ArrowRight />} {toProduction ? "Pasar a producción" : `Avanzar a ${nextLabel}`}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={toProduction ? "Pasar a producción" : `Avanzar a «${nextLabel}»`}
        description={toProduction ? "El proyecto se cierra con éxito y pasa a SAP / producción." : "Se notificará al solicitante y a los departamentos implicados."}
      >
        {pendingSections.length > 0 && (
          <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-slate-800">
            <p className="font-semibold">La ficha técnica tiene apartados sin terminar:</p>
            <ul className="mt-1 list-disc pl-5">
              {pendingSections.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <label className="mt-3 flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={force} onChange={(e) => setForce(e.target.checked)} />
              <span>Avanzar igualmente. Los departamentos podrán completarlos después.</span>
            </label>
          </div>
        )}
        <Field label="Comentario" hint="Opcional">
          <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button disabled={busy || blocked} onClick={() => run(() => advancePhaseAction(projectId, comment), toProduction ? "Proyecto en producción" : `Fase: ${nextLabel}`, () => setOpen(false))}>
            {busy && <Loader2 className="animate-spin" />} Confirmar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Anticipo pendiente (PL iniciado sin anticipo) ────────────────────────

export function PrepaymentReceivedDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const { busy, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Wallet /> Registrar anticipo recibido
        </Button>
      </DialogTrigger>
      <DialogContent title="Registrar anticipo del 30 %">
        <Field label="Nota" hint="Opcional: fecha, referencia…">
          <Input value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button disabled={busy} onClick={() => run(() => markPrepaymentAction(projectId, note), "Anticipo registrado", () => setOpen(false))}>
            {busy && <Loader2 className="animate-spin" />} Confirmar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
