"use client";
import { CheckCircle2, HelpCircle, Loader2, PauseCircle, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { decideGateAction } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { Option } from "@/lib/catalog-defaults";
import { cn } from "@/lib/utils";

type Kind = "approve" | "request_info" | "reject" | "pause";

export type GateDialogProps = {
  projectId: string;
  gateLabel: string;
  summary: { completeness: number; requester: string; requestedAt: string };
  templates: { id: number; name: string; departmentIds: number[]; score: number }[];
  departments: { id: number; name: string; color: string }[];
  fields: { key: string; label: string; missing: boolean; level: string }[];
  rejectionReasons: Option[];
};

const TABS: { k: Kind; label: string; icon: React.ElementType; tone: string }[] = [
  { k: "approve", label: "Aprobar", icon: CheckCircle2, tone: "text-emerald-700" },
  { k: "request_info", label: "Pedir más info", icon: HelpCircle, tone: "text-amber-700" },
  { k: "reject", label: "Rechazar", icon: XCircle, tone: "text-rose-700" },
  { k: "pause", label: "Pausar", icon: PauseCircle, tone: "text-slate-700" },
];

/** Modal de decisión de puerta G1 (§7.3). */
export function GateDialog(props: GateDialogProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<Kind>("approve");
  const best = props.templates[0];
  const [templateId, setTemplateId] = React.useState<number | null>(best?.id ?? null);
  const [deptIds, setDeptIds] = React.useState<number[]>(best?.departmentIds ?? []);
  const [comment, setComment] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [fields, setFields] = React.useState<string[]>([]);
  const [reasonCode, setReasonCode] = React.useState("");
  const [reasonText, setReasonText] = React.useState("");
  const [pauseReason, setPauseReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const chooseTemplate = (id: number | null) => {
    setTemplateId(id);
    const t = props.templates.find((x) => x.id === id);
    if (t) setDeptIds(t.departmentIds);
  };

  async function confirm() {
    setErrors({});
    const decision =
      kind === "approve"
        ? { kind, templateId, departmentIds: deptIds, comment: comment || null }
        : kind === "request_info"
          ? { kind, message, fields }
          : kind === "reject"
            ? { kind, reasonCode, reasonText: reasonText || null }
            : { kind, reason: pauseReason };
    setBusy(true);
    const res = await decideGateAction(props.projectId, decision);
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      toast.error(res.error);
      return;
    }
    toast.success(
      { approve: "Proyecto aprobado. Se ha notificado a los departamentos.", request_info: "Petición de información enviada al solicitante.", reject: "Proyecto rechazado.", pause: "Proyecto en pausa." }[kind],
    );
    setOpen(false);
    router.refresh();
  }

  const missingCount = props.fields.filter((f) => f.missing).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Decidir solicitud (P1)</Button>
      </DialogTrigger>
      <DialogContent title={`Decisión · ${props.gateLabel}`} description={`Solicitado por ${props.summary.requester} el ${props.summary.requestedAt} · brief completo al ${props.summary.completeness}%`} wide>
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
              <Field label="Plantilla de flujo" hint="Sugerida por tipo, subtipo y categoría. Precarga los departamentos.">
                <Select value={templateId ?? ""} onChange={(e) => chooseTemplate(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Sin plantilla</option>
                  {props.templates.map((t, i) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {i === 0 && t.score > 0 ? " (sugerida)" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Departamentos implicados" required error={errors.departmentIds}>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {props.departments.map((d) => (
                    <label key={d.id} className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm ring-1", deptIds.includes(d.id) ? "bg-brand-50 ring-brand-300" : "ring-slate-200")}>
                      <input
                        type="checkbox"
                        className="size-4 accent-brand-600"
                        checked={deptIds.includes(d.id)}
                        onChange={(e) => setDeptIds(e.target.checked ? [...deptIds, d.id] : deptIds.filter((x) => x !== d.id))}
                      />
                      <span className="size-2 rounded-full" style={{ background: d.color }} aria-hidden />
                      {d.name}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-500">{deptIds.length} seleccionados · recibirán un email con el resumen del proyecto.</p>
              </Field>
              <Field label="Comentario (opcional)">
                <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
              </Field>
            </>
          )}

          {kind === "request_info" && (
            <>
              <Field label="¿Qué información falta?" required error={errors.message}>
                <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe lo que necesitas para poder decidir…" />
              </Field>
              <Field label="Campos del brief a completar (opcional)" hint={`Se resaltarán al solicitante. ${missingCount} campos sin rellenar marcados con •`}>
                <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-slate-200 p-2 sm:grid-cols-2">
                  {props.fields.map((f) => (
                    <Checkbox
                      key={f.key}
                      label={
                        <span>
                          {f.label} {f.missing && <span className="text-amber-600" title="Sin rellenar">•</span>}
                        </span>
                      }
                      checked={fields.includes(f.key)}
                      onChange={(e) => setFields(e.target.checked ? [...fields, f.key] : fields.filter((x) => x !== f.key))}
                    />
                  ))}
                </div>
              </Field>
            </>
          )}

          {kind === "reject" && (
            <>
              <Field label="Motivo" required error={errors.reasonCode}>
                <Select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                  <option value="">Selecciona…</option>
                  {props.rejectionReasons.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Explicación" required={reasonCode === "otro"} error={errors.reasonText}>
                <Textarea rows={3} value={reasonText} onChange={(e) => setReasonText(e.target.value)} />
              </Field>
            </>
          )}

          {kind === "pause" && (
            <Field label="Motivo de la pausa" required error={errors.reason}>
              <Textarea rows={3} value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} />
            </Field>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            variant={kind === "reject" ? "danger" : kind === "request_info" ? "warning" : "default"}
            onClick={confirm}
            disabled={
              busy ||
              (kind === "approve" && !deptIds.length) ||
              (kind === "request_info" && !message.trim()) ||
              (kind === "reject" && (!reasonCode || (reasonCode === "otro" && !reasonText.trim()))) ||
              (kind === "pause" && !pauseReason.trim())
            }
          >
            {busy && <Loader2 className="animate-spin" />}
            Confirmar {TABS.find((t) => t.k === kind)!.label.toLowerCase()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
