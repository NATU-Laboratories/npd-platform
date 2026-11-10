"use client";
import { ArrowRight, CheckCircle2, Factory, Loader2, PauseCircle, RotateCcw, Send, Wallet, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { advancePhaseAction, decideBudgetAction, markPrepaymentAction, sendQuoteAction } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ScalarInput } from "@/components/sheet/section-editor";
import { Uploader, type UploadedFile } from "@/components/uploader";
import type { Option } from "@/lib/catalog-defaults";
import { quoteSpecGroups, SECTION_BY_KEY, type SheetData } from "@/lib/sheet/sections";
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

/** Selector de dos opciones (único / por referencia). */
function ModeChoice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <legend className="mb-1 w-full text-sm font-medium text-slate-900">{label}</legend>
      {options.map(([v, l]) => (
        <label key={v} className="flex cursor-pointer items-center gap-1.5 text-sm">
          <input type="radio" className="accent-brand-600" checked={value === v} onChange={() => onChange(v)} /> {l}
        </label>
      ))}
    </fieldset>
  );
}

export function QuoteDialog({
  projectId,
  initial,
  files,
  maxMb,
  requesterName,
  specsInitial,
  formulaCost,
  references = [],
  modes,
}: {
  projectId: string;
  /** Comercial que creó la solicitud: único destinatario del aviso. */
  requesterName: string;
  /** Datos actuales de «Envase y packaging» (Marketing): se rellenan con las especificaciones cotizadas. */
  specsInitial: SheetData;
  /** Coste objetivo de la fórmula; undefined si el usuario no puede verlo (Comercial y resto de departamentos). */
  formulaCost?: number | null;
  /** Datos actuales de la ficha de Comercial (precio objetivo, PVP y unidades vienen del brief). */
  initial: SheetData;
  /** PDFs ya subidos con la etiqueta «cotizacion». */
  files: UploadedFile[];
  maxMb: number;
  /** Referencias del proyecto (con dos o más se puede cotizar y especificar el envase por referencia). */
  references?: { id: number; title: string; unitPrice: number | null; specs: SheetData }[];
  modes?: { pricing: "single" | "per_reference"; packaging: "common" | "per_reference" };
}) {
  const section = SECTION_BY_KEY.comercial!;
  const multi = references.length >= 2;
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<SheetData>(initial);
  const [comment, setComment] = React.useState("");
  const [specs, setSpecs] = React.useState<SheetData>(specsInitial);
  const canSeeCost = formulaCost !== undefined;
  const [cost, setCost] = React.useState(formulaCost != null ? String(formulaCost) : "");
  const [pricing, setPricing] = React.useState(modes?.pricing ?? "single");
  const [packaging, setPackaging] = React.useState(modes?.packaging ?? "common");
  const initRefPrices = () => Object.fromEntries(references.map((r) => [String(r.id), r.unitPrice != null ? String(r.unitPrice) : ""]));
  const initRefSpecs = () => Object.fromEntries(references.map((r) => [String(r.id), { ...specsInitial, ...r.specs }]));
  const [refPrices, setRefPrices] = React.useState<Record<string, string>>(initRefPrices);
  const [refSpecs, setRefSpecs] = React.useState<Record<string, SheetData>>(initRefSpecs);
  const [specRef, setSpecRef] = React.useState(references[0] ? String(references[0].id) : "");
  const { busy, errors, run } = useAction();
  const specGroups = quoteSpecGroups();
  const perRefPrice = multi && pricing === "per_reference";
  const perRefPack = multi && packaging === "per_reference";
  const fields = section.groups.flatMap((g) => g.fields).filter((f) => f.key !== "finalUnitPrice" && !(perRefPrice && f.key === "unitPrice"));
  const priceReady = perRefPrice ? references.every((r) => refPrices[String(r.id)]?.trim()) : typeof data.unitPrice === "number";
  const curSpecs = perRefPack ? (refSpecs[specRef] ?? {}) : specs;
  const setSpec = (k: string, v: unknown) =>
    perRefPack ? setRefSpecs((m) => ({ ...m, [specRef]: { ...(m[specRef] ?? {}), [k]: v } })) : setSpecs((d) => ({ ...d, [k]: v }));
  const num = (s: string) => (s.trim() ? Number(s.replace(",", ".")) : null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setData(initial);
          setSpecs(specsInitial);
          setCost(formulaCost != null ? String(formulaCost) : "");
          setRefPrices(initRefPrices());
          setRefSpecs(initRefSpecs());
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Send /> Enviar cotización al comercial
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Enviar cotización al comercial"
        description={`Completa la cotización. Solo ${requesterName} (quien creó la solicitud) recibirá un email de aviso con estas condiciones para presentárselas al cliente. El proyecto pasa a «Valoración con cliente».`}
        wide
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {multi && (
            <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4 sm:col-span-2">
              <ModeChoice
                label={`Precio (${references.length} referencias)`}
                value={pricing}
                onChange={(v) => setPricing(v as typeof pricing)}
                options={[
                  ["single", "Precio único"],
                  ["per_reference", "Precio por referencia"],
                ]}
              />
              {perRefPrice && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {references.map((r) => (
                    <Field key={r.id} label={`${r.title} (€/ud)`} required htmlFor={`quote-ref-price-${r.id}`}>
                      <Input
                        id={`quote-ref-price-${r.id}`}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min={0}
                        value={refPrices[String(r.id)] ?? ""}
                        onChange={(e) => setRefPrices((m) => ({ ...m, [String(r.id)]: e.target.value }))}
                        className="max-w-40"
                      />
                    </Field>
                  ))}
                </div>
              )}
            </div>
          )}
          {fields.map((f) => {
            if (f.type === "files") return null;
            const id = `quote-${f.key}`;
            return (
              <Field
                key={f.key}
                label={f.label}
                hint={f.hint}
                htmlFor={id}
                required={f.key === "unitPrice"}
                error={errors[f.key]}
                className={cn(f.type === "textarea" && "sm:col-span-2")}
              >
                <ScalarInput f={f} id={id} value={data[f.key]} onChange={(v) => setData((d) => ({ ...d, [f.key]: v }))} />
              </Field>
            );
          })}
          <div className="flex flex-col gap-4 border-t border-slate-100 pt-4 sm:col-span-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Presupuesto desglosado</h3>
              <p className="text-xs text-slate-500">Especificaciones cotizadas. Se incluyen en el email al comercial y quedan en «Envase y packaging» de Marketing.</p>
            </div>
            {multi && (
              <ModeChoice
                label="Envase y packaging"
                value={packaging}
                onChange={(v) => setPackaging(v as typeof packaging)}
                options={[
                  ["common", "Común a todas las referencias"],
                  ["per_reference", "Distinto por referencia"],
                ]}
              />
            )}
            {perRefPack && (
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Referencia">
                {references.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="tab"
                    aria-selected={specRef === String(r.id)}
                    onClick={() => setSpecRef(String(r.id))}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium ring-1",
                      specRef === String(r.id) ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                    )}
                  >
                    {r.title}
                  </button>
                ))}
              </div>
            )}
            {specGroups.map((g) => (
              <fieldset key={`${specRef}-${g.title}`} className="flex flex-col gap-3">
                <legend className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{g.title}</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  {g.fields.map((f) => {
                    const id = `quote-spec-${f.key}`;
                    return (
                      <Field key={f.key} label={f.label} htmlFor={id} className={cn((f.type === "textarea" || f.type === "multi") && "sm:col-span-2")}>
                        <ScalarInput f={f} id={id} value={curSpecs[f.key]} onChange={(v) => setSpec(f.key, v)} />
                      </Field>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
          {canSeeCost && (
            <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-4 sm:col-span-2">
              <Field
                label="Coste objetivo de la fórmula (€/litro) · confidencial"
                htmlFor="quote-formula-cost"
                hint="Solo lo ven Laboratorio / I+D, el gestor de proyectos y Operaciones. No aparece en la cotización ni le llega al comercial; Laboratorio lo recibe en su aviso para empezar a formular."
              >
                <Input
                  id="quote-formula-cost"
                  type="number"
                  inputMode="decimal"
                  step="0.0001"
                  min={0}
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  className="max-w-40"
                />
              </Field>
            </div>
          )}
          <Field label="PDF de la cotización" hint="Opcional. Se guarda en «01 Cotización y valoración», junto al documento de cotización que genera la plataforma." className="sm:col-span-2">
            <Uploader projectId={projectId} phase={1} initial={files} maxMb={maxMb} defaultTag="cotizacion" showTags={false} compact />
          </Field>
          <Field label="Mensaje para el comercial" hint="Opcional" className="sm:col-span-2">
            <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            disabled={busy || !priceReady}
            onClick={() =>
              run(
                () =>
                  sendQuoteAction(projectId, {
                    data,
                    specs,
                    comment,
                    ...(multi
                      ? {
                          pricingMode: pricing,
                          packagingMode: packaging,
                          refPrices: perRefPrice ? Object.fromEntries(Object.entries(refPrices).map(([k, v]) => [k, num(v)])) : undefined,
                          refSpecs: perRefPack ? refSpecs : undefined,
                        }
                      : {}),
                    ...(canSeeCost ? { formulaTargetCost: num(cost) } : {}),
                  }),
                "Cotización enviada al comercial. El proyecto pasa a Valoración con cliente.",
                () => setOpen(false),
              )
            }
          >
            {busy && <Loader2 className="animate-spin" />} Enviar al comercial
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Fase 2: G2 · aprobación del presupuesto ──────────────────────────────

type BudgetKind = "approve" | "changes" | "reject" | "pause";
const TABS: { k: BudgetKind; label: string; icon: React.ElementType; tone: string }[] = [
  { k: "approve", label: "Cliente aprueba", icon: CheckCircle2, tone: "text-[#56613f]" },
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
  priceReferences = [],
}: {
  projectId: string;
  requiresPrepayment: boolean;
  currentUserName: string;
  quoteInfo: string | null;
  rejectionReasons: Option[];
  /** Si se cotizó por referencia: precio final de cada una. */
  priceReferences?: { id: number; title: string; quoted: number | null }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<BudgetKind>("approve");
  const [comment, setComment] = React.useState("");
  const [finalPrice, setFinalPrice] = React.useState("");
  const [refFinal, setRefFinal] = React.useState<Record<string, string>>({});
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
            finalUnitPrice: !priceReferences.length && finalPrice ? Number(finalPrice.replace(",", ".")) : null,
            refFinalPrices: priceReferences.length
              ? Object.fromEntries(Object.entries(refFinal).map(([k, v]) => [k, v.trim() ? Number(v.replace(",", ".")) : null]))
              : undefined,
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
        <Button>Registrar respuesta del cliente (P2)</Button>
      </DialogTrigger>
      <DialogContent title="P2 · Aprobación del presupuesto" description={quoteInfo ?? "Registra la respuesta del cliente a la cotización."} wide>
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
              {priceReferences.length ? (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium text-slate-900">Precio unitario final por referencia (€/ud)</legend>
                  <p className="text-xs text-slate-500">Opcional: el acordado con el cliente. Se guarda en la ficha de Comercial.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {priceReferences.map((r) => (
                      <Field key={r.id} label={r.title} hint={r.quoted != null ? `Cotizado: ${r.quoted.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}` : undefined} htmlFor={`final-${r.id}`}>
                        <Input
                          id={`final-${r.id}`}
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min={0}
                          value={refFinal[String(r.id)] ?? ""}
                          onChange={(e) => setRefFinal((m) => ({ ...m, [String(r.id)]: e.target.value }))}
                          className="max-w-40"
                        />
                      </Field>
                    ))}
                  </div>
                </fieldset>
              ) : (
                <Field label="Precio unitario final (€/ud)" hint="Opcional: el acordado con el cliente. Se guarda en la ficha de Comercial.">
                  <Input type="number" inputMode="decimal" step="0.01" min={0} value={finalPrice} onChange={(e) => setFinalPrice(e.target.value)} className="max-w-40" />
                </Field>
              )}
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
                        <Input value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder="Nombre y apellidos…" />
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
            <Field label="¿Qué cambios pide el cliente?" required hint="El proyecto vuelve a Cotización y Comercial abre una nueva ronda.">
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
            <p className="font-semibold">Hay departamentos que aún no han completado su parte:</p>
            <ul className="mt-1 list-disc pl-5">
              {pendingSections.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <label className="mt-3 flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={force} onChange={(e) => setForce(e.target.checked)} />
              <span>Avanzar igualmente. Los departamentos podrán terminar después.</span>
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
