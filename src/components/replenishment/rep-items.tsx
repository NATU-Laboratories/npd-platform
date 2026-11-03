"use client";
import { Eye, Loader2, Pencil, Receipt, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { previewSupplierEmailsAction, registerQuoteAction, requestQuotesAction, updateRepItemAction } from "@/app/actions/replenishments";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ELEMENT_LABEL, QUOTE_STATUS_LABEL } from "@/lib/replenishment/config";
import type { RepEmail } from "@/lib/server/replenishments";
import { cn, formatDate } from "@/lib/utils";
import { EmailPreview } from "./email-preview";
import type { SupplierOption } from "./new-form";

export type RepItemRow = {
  id: number;
  element: string;
  description: string | null;
  quantity: number | null;
  supplierId: number | null;
  supplierName: string | null;
  supplierEmails: string[];
  quoteStatus: string;
  quotePrice: string | null;
  quoteNotes: string | null;
  quoteRequestedAt: string | null;
  quoteReceivedAt: string | null;
};

const QUOTE_TONE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  requested: "bg-amber-50 text-amber-800",
  received: "bg-[#eef0e6] text-[#56613f]",
};

const QUOTE_MESSAGE = "Necesitamos reponer los materiales indicados. Por favor, enviadnos la cotización actualizada y el plazo de entrega.\n\nGracias.";

export function RepItems({ id, items, suppliers, canEdit }: { id: string; items: RepItemRow[]; suppliers: SupplierOption[]; canEdit: boolean }) {
  const [edit, setEdit] = React.useState<RepItemRow | null>(null);
  const [quote, setQuote] = React.useState<RepItemRow | null>(null);
  const [ask, setAsk] = React.useState<number | null | undefined>(undefined);
  const supplierCount = new Set(items.map((i) => i.supplierId).filter(Boolean)).size;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th className="py-2 pr-3 font-medium">Elemento</th>
              <th className="py-2 pr-3 font-medium">Cantidad</th>
              <th className="py-2 pr-3 font-medium">Proveedor</th>
              <th className="py-2 pr-3 font-medium">Recotización</th>
              {canEdit && <th className="py-2 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-3">
                  <p className="font-medium text-slate-800">{ELEMENT_LABEL[i.element] ?? i.element}</p>
                  {i.description && <p className="text-xs text-slate-500">{i.description}</p>}
                </td>
                <td className="whitespace-nowrap py-2 pr-3">{i.quantity ? `${i.quantity.toLocaleString("es-ES")} uds` : "—"}</td>
                <td className="py-2 pr-3">
                  <p>{i.supplierName ?? <span className="text-amber-700">Sin proveedor</span>}</p>
                  <p className="text-xs text-slate-500">{i.supplierEmails.join(", ") || (i.supplierName ? <span className="text-amber-700">sin email</span> : null)}</p>
                </td>
                <td className="py-2 pr-3">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs", QUOTE_TONE[i.quoteStatus])}>{QUOTE_STATUS_LABEL[i.quoteStatus] ?? i.quoteStatus}</span>
                  {i.quotePrice && <p className="mt-1 text-xs font-medium text-slate-800">{Number(i.quotePrice).toLocaleString("es-ES", { maximumFractionDigits: 4 })} €/ud</p>}
                  {i.quoteNotes && <p className="text-xs text-slate-500">{i.quoteNotes}</p>}
                  {i.quoteStatus === "requested" && i.quoteRequestedAt && <p className="text-xs text-slate-400">Pedida el {formatDate(i.quoteRequestedAt)}</p>}
                </td>
                {canEdit && (
                  <td className="whitespace-nowrap py-2 text-right">
                    <button type="button" onClick={() => setQuote(i)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Registrar recotización" aria-label={`Registrar recotización de ${ELEMENT_LABEL[i.element]}`}>
                      <Receipt className="size-4" />
                    </button>
                    {i.supplierId && (
                      <button type="button" onClick={() => setAsk(i.supplierId)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Pedir recotización a este proveedor" aria-label={`Pedir recotización a ${i.supplierName}`}>
                        <Send className="size-4" />
                      </button>
                    )}
                    <button type="button" onClick={() => setEdit(i)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Editar" aria-label={`Editar ${ELEMENT_LABEL[i.element]}`}>
                      <Pencil className="size-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && supplierCount > 0 && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setAsk(null)}>
          <Send /> Pedir recotización {supplierCount > 1 ? `a los ${supplierCount} proveedores` : "al proveedor"}
        </Button>
      )}
      {edit && <EditItemDialog item={edit} suppliers={suppliers} onClose={() => setEdit(null)} />}
      {quote && <QuoteDialog item={quote} onClose={() => setQuote(null)} />}
      {ask !== undefined && <AskQuoteDialog id={id} supplierId={ask} onClose={() => setAsk(undefined)} />}
    </>
  );
}

function EditItemDialog({ item, suppliers, onClose }: { item: RepItemRow; suppliers: SupplierOption[]; onClose: () => void }) {
  const router = useRouter();
  const [supplierId, setSupplierId] = React.useState(item.supplierId ? String(item.supplierId) : "");
  const [newName, setNewName] = React.useState("");
  const [newEmail, setNewEmail] = React.useState("");
  const [quantity, setQuantity] = React.useState(item.quantity ? String(item.quantity) : "");
  const [description, setDescription] = React.useState(item.description ?? "");
  const [busy, setBusy] = React.useState(false);
  async function save() {
    setBusy(true);
    const res = await updateRepItemAction({
      itemId: item.id,
      supplierId: supplierId && supplierId !== "__new" ? Number(supplierId) : null,
      newSupplier: supplierId === "__new" && newName.trim() ? { name: newName.trim(), email: newEmail.trim() } : null,
      quantity: quantity ? Number(quantity) : null,
      description: description || null,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Elemento actualizado");
    onClose();
    router.refresh();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Editar ${ELEMENT_LABEL[item.element] ?? item.element}`} description="Si cambias el proveedor, la recotización vuelve a «Sin pedir».">
        <div className="flex flex-col gap-3">
          <Field label="Proveedor" required htmlFor="ei-sup">
            <Select id="ei-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Elige proveedor…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option value="__new">+ Nuevo proveedor…</option>
            </Select>
          </Field>
          {supplierId === "__new" && (
            <div className="grid gap-2 rounded-md bg-slate-50 p-2 sm:grid-cols-2">
              <Field label="Nombre" required htmlFor="ei-nn">
                <Input id="ei-nn" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={200} />
              </Field>
              <Field label="Email" htmlFor="ei-ne">
                <Input id="ei-ne" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              </Field>
            </div>
          )}
          <Field label="Cantidad" htmlFor="ei-qty">
            <Input id="ei-qty" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label="Descripción" htmlFor="ei-desc">
            <Input id="ei-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Guardar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function QuoteDialog({ item, onClose }: { item: RepItemRow; onClose: () => void }) {
  const router = useRouter();
  const [price, setPrice] = React.useState(item.quotePrice ? String(Number(item.quotePrice)) : "");
  const [notes, setNotes] = React.useState(item.quoteNotes ?? "");
  const [busy, setBusy] = React.useState(false);
  async function save() {
    setBusy(true);
    const res = await registerQuoteAction({ itemId: item.id, price: price.trim(), notes });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Recotización registrada");
    onClose();
    router.refresh();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Recotización · ${ELEMENT_LABEL[item.element] ?? item.element}`} description={item.supplierName ?? undefined}>
        <div className="flex flex-col gap-3">
          <Field label="Precio unitario (€/ud)" htmlFor="q-price">
            <Input id="q-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,0000" />
          </Field>
          <Field label="Notas" hint="Plazo de entrega, mínimos, validez de la oferta…" htmlFor="q-notes">
            <Textarea id="q-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Guardar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AskQuoteDialog({ id, supplierId, onClose }: { id: string; supplierId: number | null; onClose: () => void }) {
  const router = useRouter();
  const [message, setMessage] = React.useState(QUOTE_MESSAGE);
  const [preview, setPreview] = React.useState<{ key: string; emails: RepEmail[] } | null>(null);
  const [busy, setBusy] = React.useState(false);
  async function doPreview() {
    setBusy(true);
    const res = await previewSupplierEmailsAction(id, "quote", supplierId, message);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setPreview({ key: message, emails: res.data ?? [] });
  }
  async function send() {
    setBusy(true);
    const res = await requestQuotesAction(id, supplierId, message);
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
      <DialogContent title="Pedir recotización" description="El proveedor recibe los materiales, cantidades y fecha, y responde directamente a Compras." wide>
        <div className="flex flex-col gap-3">
          <Field label="Mensaje para el proveedor" htmlFor="aq-msg">
            <Textarea id="aq-msg" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} className="min-h-24" />
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
