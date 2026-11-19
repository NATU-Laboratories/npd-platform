"use client";
import { Check, Eye, Loader2, Pencil, Plus, Receipt, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import {
  addComponentAction,
  chooseComponentQuoteAction,
  deleteComponentAction,
  previewComponentQuotesAction,
  registerComponentQuoteAction,
  requestComponentQuotesAction,
  setComponentSupplierAction,
  updateComponentAction,
} from "@/app/actions/purchasing";
import { EmailPreview } from "@/components/replenishment/email-preview";
import type { SupplierOption } from "@/components/replenishment/new-form";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { COMPONENT_LABEL, COMPONENT_QUOTE_STATUS, COMPONENTS, componentLabel, fmtSupplierPrice, isMikadoOnly, MAX_SUPPLIERS, SUPPLIER_PRICE_UNIT } from "@/lib/purchasing/components";
import type { ComponentQuoteView, ComponentView } from "@/lib/server/purchasing";
import type { RepEmail } from "@/lib/server/replenishments";
import { cn, formatDate } from "@/lib/utils";

const TONE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  requested: "bg-amber-50 text-amber-800",
  received: "bg-[#eef0e6] text-[#56613f]",
};
const QUOTE_MESSAGE = "Por favor, enviadnos precio por millar, cantidad mínima y plazo de entrega de cada componente.\n\nGracias.";
const eur = fmtSupplierPrice;

type Ask = { supplierId: number | null; componentId: number | null; title: string };

/**
 * Desglose de componentes del proyecto (Compras): cada componente con hasta 3 proveedores, su
 * cotización y el proveedor elegido (con el porqué).
 */
export function ComponentsCard({
  projectId,
  components,
  suppliers,
  canEdit,
  mikado,
}: {
  projectId: string;
  components: ComponentView[];
  suppliers: SupplierOption[];
  canEdit: boolean;
  /** Proyecto de mikado: ofrece varillas y flor. */
  mikado: boolean;
}) {
  const [slot, setSlot] = React.useState<{ c: ComponentView; slot: number; q?: ComponentQuoteView } | null>(null);
  const [price, setPrice] = React.useState<{ c: ComponentView; q: ComponentQuoteView } | null>(null);
  const [choose, setChoose] = React.useState<{ c: ComponentView; q: ComponentQuoteView } | null>(null);
  const [edit, setEdit] = React.useState<ComponentView | null>(null);
  const [ask, setAsk] = React.useState<Ask | null>(null);
  const allSuppliers = new Set(components.flatMap((c) => c.quotes.map((q) => q.supplierId))).size;
  const chosen = components.filter((c) => c.chosenQuoteId).length;
  if (!canEdit && !components.length) return null;

  return (
    <Card id="componentes" className="scroll-mt-24">
      <CardHeader
        title="Componentes y proveedores"
        description={`Desglose de piezas del proyecto. Compras pide cotización de cada componente a hasta ${MAX_SUPPLIERS} proveedores y elige uno.${components.length ? ` ${chosen} de ${components.length} con proveedor elegido.` : ""}`}
        actions={
          canEdit && allSuppliers > 0 ? (
            <Button size="sm" variant="secondary" onClick={() => setAsk({ supplierId: null, componentId: null, title: `Pedir cotización a ${allSuppliers === 1 ? "1 proveedor" : `los ${allSuppliers} proveedores`}` })}>
              <Send /> Pedir cotizaciones
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-col divide-y divide-slate-100">
        {!components.length && <p className="px-5 py-4 text-sm text-slate-500">Todavía no hay componentes. Añade los que lleva el producto (frasco, tapón, etiqueta…).</p>}
        {components.map((c) => (
          <section key={c.id} className="flex flex-col gap-3 px-4 py-4 sm:px-5" aria-label={componentLabel(c)}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-slate-900">{COMPONENT_LABEL[c.component] ?? c.component}</h3>
                {c.description && <p className="text-xs text-slate-500">{c.description}</p>}
              </div>
              {canEdit && (
                <div className="flex items-center gap-1">
                  {c.quotes.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setAsk({ supplierId: null, componentId: c.id, title: `Pedir cotización · ${componentLabel(c)}` })}>
                      <Send /> Pedir cotización
                    </Button>
                  )}
                  <button type="button" onClick={() => setEdit(c)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label={`Editar ${componentLabel(c)}`} title="Editar">
                    <Pencil className="size-4" />
                  </button>
                  <DeleteButton c={c} />
                </div>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {Array.from({ length: MAX_SUPPLIERS }, (_, i) => i + 1).map((n) => {
                const q = c.quotes.find((x) => x.slot === n);
                if (!q)
                  return canEdit ? (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setSlot({ c, slot: n })}
                      className="flex min-h-12 sm:min-h-24 items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 text-sm text-slate-500 hover:border-slate-400 hover:bg-slate-50"
                    >
                      <Plus className="size-4" aria-hidden /> Proveedor {n}
                    </button>
                  ) : (
                    <div key={n} className="hidden sm:block" />
                  );
                const isChosen = c.chosenQuoteId === q.id;
                return (
                  <div key={n} className={cn("flex flex-col gap-1.5 rounded-lg border p-3 text-sm", isChosen ? "border-[#7f8f63] bg-[#f4f6ee]" : "border-slate-200")}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{q.supplierName}</p>
                        <p className={cn("truncate text-xs", q.supplierEmails.length ? "text-slate-500" : "text-amber-700")}>{q.supplierEmails.join(", ") || "sin email"}</p>
                      </div>
                      {isChosen && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-[#56613f] px-2 py-0.5 text-[11px] font-medium text-white">
                          <Check className="size-3" aria-hidden /> Elegido
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs", TONE[q.status])}>{COMPONENT_QUOTE_STATUS[q.status] ?? q.status}</span>
                      {q.price && <span className="font-medium tabular-nums text-slate-900">{eur(q.price)}</span>}
                    </div>
                    {q.notes && <p className="whitespace-pre-line text-xs text-slate-600">{q.notes}</p>}
                    {q.status === "requested" && q.requestedAt && <p className="text-xs text-slate-400">Pedida el {formatDate(q.requestedAt)}</p>}
                    {canEdit && (
                      <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
                        <button type="button" onClick={() => setPrice({ c, q })} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Registrar precio" aria-label={`Registrar precio de ${q.supplierName}`}>
                          <Receipt className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setAsk({ supplierId: q.supplierId, componentId: c.id, title: `Pedir cotización a ${q.supplierName}` })}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                          title="Pedir cotización a este proveedor"
                          aria-label={`Pedir cotización a ${q.supplierName}`}
                        >
                          <Send className="size-4" />
                        </button>
                        <button type="button" onClick={() => setSlot({ c, slot: n, q })} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Cambiar proveedor" aria-label={`Cambiar proveedor ${n}`}>
                          <Pencil className="size-4" />
                        </button>
                        {!isChosen && (
                          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setChoose({ c, q })}>
                            Elegir
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {c.chosenQuoteId && (
              <ChosenNote c={c} canEdit={canEdit} />
            )}
          </section>
        ))}
        {canEdit && <AddComponent projectId={projectId} mikado={mikado} />}
      </div>
      {slot && <SupplierDialog {...slot} suppliers={suppliers} onClose={() => setSlot(null)} />}
      {price && <PriceDialog {...price} onClose={() => setPrice(null)} />}
      {choose && <ChooseDialog {...choose} onClose={() => setChoose(null)} />}
      {edit && <EditDialog c={edit} onClose={() => setEdit(null)} />}
      {ask && <AskDialog projectId={projectId} ask={ask} onClose={() => setAsk(null)} />}
    </Card>
  );
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  async function exec(fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Error");
      return false;
    }
    if (ok) toast.success(ok);
    router.refresh();
    return true;
  }
  return { busy, exec };
}

function ChosenNote({ c, canEdit }: { c: ComponentView; canEdit: boolean }) {
  const { busy, exec } = useAction();
  const q = c.quotes.find((x) => x.id === c.chosenQuoteId);
  return (
    <div className="rounded-md bg-[#eef0e6] px-3 py-2 text-xs text-[#56613f]">
      <p>
        <strong className="font-semibold">Proveedor elegido: {q?.supplierName ?? "—"}</strong>
        {c.chosenBy ? ` · ${c.chosenBy}` : ""}
        {c.chosenAt ? ` · ${formatDate(c.chosenAt)}` : ""}
        {canEdit && (
          <button type="button" disabled={busy} onClick={() => exec(() => chooseComponentQuoteAction(c.id, null))} className="ml-2 underline hover:no-underline">
            Quitar elección
          </button>
        )}
      </p>
      {c.choiceComment && <p className="mt-0.5 whitespace-pre-line text-slate-700">Motivo: {c.choiceComment}</p>}
    </div>
  );
}

function DeleteButton({ c }: { c: ComponentView }) {
  const { busy, exec } = useAction();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (confirm(`¿Quitar «${componentLabel(c)}» y sus proveedores del desglose?`)) void exec(() => deleteComponentAction(c.id), "Componente quitado");
      }}
      className="rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
      aria-label={`Quitar ${componentLabel(c)}`}
      title="Quitar"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
    </button>
  );
}

function AddComponent({ projectId, mikado }: { projectId: string; mikado: boolean }) {
  const { busy, exec } = useAction();
  const [component, setComponent] = React.useState("");
  const [description, setDescription] = React.useState("");
  const options = COMPONENTS.filter((c) => mikado || !isMikadoOnly(c.key));
  async function add() {
    if (await exec(() => addComponentAction(projectId, component, description || null), "Componente añadido")) {
      setComponent("");
      setDescription("");
    }
  }
  return (
    <div className="flex flex-wrap items-end gap-2 bg-slate-50/60 px-4 py-3 sm:px-5">
      <Field label="Añadir componente" htmlFor="pc-new" className="min-w-44">
        <Select id="pc-new" value={component} onChange={(e) => setComponent(e.target.value)}>
          <option value="">Elige componente…</option>
          {options.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Detalle (opcional)" htmlFor="pc-desc" className="min-w-56 flex-1">
        <Input id="pc-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="Modelo, material, medidas…" autoComplete="off" />
      </Field>
      <Button onClick={add} disabled={busy || !component}>
        {busy ? <Loader2 className="animate-spin" /> : <Plus />} Añadir
      </Button>
    </div>
  );
}

function Actions({ busy, onClose, onSave, label = "Guardar", disabled }: { busy: boolean; onClose: () => void; onSave: () => void; label?: string; disabled?: boolean }) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={onClose}>
        Cancelar
      </Button>
      <Button onClick={onSave} disabled={busy || disabled}>
        {busy && <Loader2 className="animate-spin" />} {label}
      </Button>
    </div>
  );
}

function SupplierDialog({ c, slot, q, suppliers, onClose }: { c: ComponentView; slot: number; q?: ComponentQuoteView; suppliers: SupplierOption[]; onClose: () => void }) {
  const { busy, exec } = useAction();
  const taken = new Set(c.quotes.filter((x) => x.slot !== slot).map((x) => x.supplierId));
  const [supplierId, setSupplierId] = React.useState(q ? String(q.supplierId) : "");
  const [newName, setNewName] = React.useState("");
  const [newEmail, setNewEmail] = React.useState("");
  async function save(remove = false) {
    const ok = await exec(() =>
      setComponentSupplierAction({
        componentId: c.id,
        slot,
        supplierId: remove || supplierId === "__new" || !supplierId ? null : Number(supplierId),
        newSupplier: !remove && supplierId === "__new" ? { name: newName.trim(), email: newEmail.trim() } : null,
      }),
    );
    if (ok) onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${componentLabel(c)} · proveedor ${slot}`} description={q ? "Si cambias el proveedor, su cotización vuelve a «Sin pedir»." : undefined}>
        <div className="flex flex-col gap-3">
          <Field label="Proveedor" required htmlFor="cs-sup">
            <Select id="cs-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Elige proveedor…</option>
              {suppliers
                .filter((s) => !taken.has(s.id))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.emails.length ? "" : " (sin email)"}
                  </option>
                ))}
              <option value="__new">+ Nuevo proveedor…</option>
            </Select>
          </Field>
          {supplierId === "__new" && (
            <div className="grid gap-2 rounded-md bg-slate-50 p-2 sm:grid-cols-2">
              <Field label="Nombre" required htmlFor="cs-nn">
                <Input id="cs-nn" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={200} autoComplete="off" />
              </Field>
              <Field label="Email" htmlFor="cs-ne">
                <Input id="cs-ne" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} spellCheck={false} autoComplete="off" placeholder="pedidos@proveedor.com…" />
              </Field>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {q ? (
              <Button variant="ghost" className="text-rose-700" onClick={() => save(true)} disabled={busy}>
                <Trash2 /> Quitar proveedor
              </Button>
            ) : (
              <span />
            )}
            <Actions busy={busy} onClose={onClose} onSave={() => save()} disabled={!supplierId || (supplierId === "__new" && !newName.trim())} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PriceDialog({ c, q, onClose }: { c: ComponentView; q: ComponentQuoteView; onClose: () => void }) {
  const { busy, exec } = useAction();
  const [price, setPrice] = React.useState(q.price ? String(Number(q.price)).replace(".", ",") : "");
  const [notes, setNotes] = React.useState(q.notes ?? "");
  async function save() {
    if (await exec(() => registerComponentQuoteAction(c.id, { quoteId: q.id, price: price.trim(), notes }), "Cotización registrada")) onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Cotización · ${componentLabel(c)}`} description={q.supplierName}>
        <div className="flex flex-col gap-3">
          <Field label={`Precio (${SUPPLIER_PRICE_UNIT})`} hint="Precio por cada 1.000 unidades, como lo cotizan los proveedores." htmlFor="cq-price">
            <Input id="cq-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="45,00…" className="tabular-nums" autoComplete="off" />
          </Field>
          <Field label="Notas" hint="Cantidad mínima, plazo de entrega, validez de la oferta…" htmlFor="cq-notes">
            <Textarea id="cq-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </Field>
          <Actions busy={busy} onClose={onClose} onSave={save} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChooseDialog({ c, q, onClose }: { c: ComponentView; q: ComponentQuoteView; onClose: () => void }) {
  const { busy, exec } = useAction();
  const [comment, setComment] = React.useState("");
  async function save() {
    if (await exec(() => chooseComponentQuoteAction(c.id, q.id, comment), `${q.supplierName} elegido para ${componentLabel(c)}`)) onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Elegir ${q.supplierName}`} description={`Proveedor de ${componentLabel(c)}${q.price ? ` · ${eur(q.price)}` : ""}.`}>
        <div className="flex flex-col gap-3">
          {!q.price && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Este proveedor todavía no tiene precio registrado.</p>}
          <Field label="¿Por qué este proveedor?" hint="Opcional: precio, plazo, calidad, mínimos… Queda en el historial del proyecto." htmlFor="cc-why">
            <Textarea id="cc-why" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} placeholder="Mejor precio y plazo de 3 semanas…" />
          </Field>
          <Actions busy={busy} onClose={onClose} onSave={save} label="Elegir proveedor" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ c, onClose }: { c: ComponentView; onClose: () => void }) {
  const { busy, exec } = useAction();
  const [description, setDescription] = React.useState(c.description ?? "");
  async function save() {
    if (await exec(() => updateComponentAction(c.id, description || null))) onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Editar ${COMPONENT_LABEL[c.component] ?? c.component}`}>
        <div className="flex flex-col gap-3">
          <Field label="Detalle" htmlFor="ce-desc" hint="Modelo, material, medidas… Se envía a los proveedores al pedir cotización.">
            <Input id="ce-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} autoComplete="off" />
          </Field>
          <Actions busy={busy} onClose={onClose} onSave={save} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AskDialog({ projectId, ask, onClose }: { projectId: string; ask: Ask; onClose: () => void }) {
  const router = useRouter();
  const [message, setMessage] = React.useState(QUOTE_MESSAGE);
  const [preview, setPreview] = React.useState<{ key: string; emails: RepEmail[] } | null>(null);
  const [busy, setBusy] = React.useState(false);
  async function doPreview() {
    setBusy(true);
    const res = await previewComponentQuotesAction(projectId, ask.supplierId, ask.componentId, message);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setPreview({ key: message, emails: res.data ?? [] });
  }
  async function send() {
    setBusy(true);
    const res = await requestComponentQuotesAction(projectId, ask.supplierId, ask.componentId, message);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    const d = res.data!;
    if (d.sent.length) toast.success(`Solicitud enviada a ${d.sent.join(", ")}`);
    if (d.withoutEmail.length) toast.warning(`Sin email: ${d.withoutEmail.join(", ")}. Añádelo en Backoffice → Proveedores.`);
    onClose();
    router.refresh();
  }
  const fresh = preview?.key === message;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={ask.title} description={`Cada proveedor recibe un email con sus componentes${ask.supplierId == null ? " (salvo los que ya han enviado precio)" : ""}. Alexia lee la respuesta, anota el precio y avisa a Compras.`} wide>
        <div className="flex flex-col gap-3">
          <Field label="Mensaje para el proveedor" htmlFor="ca-msg">
            <Textarea id="ca-msg" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} className="min-h-24" />
          </Field>
          <Button variant="secondary" size="sm" onClick={doPreview} disabled={busy} className="self-start">
            <Eye /> {preview ? "Actualizar vista previa" : "Revisar email"}
          </Button>
          {preview && <EmailPreview emails={preview.emails} />}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={send} disabled={busy || !fresh} title={!fresh ? "Revisa primero el email" : undefined}>
              {busy && <Loader2 className="animate-spin" />} Enviar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
