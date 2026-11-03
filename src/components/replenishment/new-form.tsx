"use client";
import { Eye, History, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { createReplenishmentAction, lastItemsForProjectAction, previewReplenishmentEmailsAction, searchNpdProjectsAction } from "@/app/actions/replenishments";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ELEMENTS, REPLENISHMENT_TEMPLATES } from "@/lib/replenishment/config";
import type { RepEmail } from "@/lib/server/replenishments";
import { cn } from "@/lib/utils";
import { EmailPreview } from "./email-preview";

export type SupplierOption = { id: number; name: string; emails: string[] };
type Item = { key: string; element: string; description: string; quantity: string; supplierId: string; newName: string; newEmail: string };

let seq = 0;
const blank = (): Item => ({ key: `i${seq++}`, element: "etiqueta", description: "", quantity: "", supplierId: "", newName: "", newEmail: "" });
const NEW = "__new";

const DEFAULT_MESSAGE = "Necesitamos reponer los materiales indicados. Por favor, enviadnos la cotización actualizada y el plazo de entrega.\n\nGracias.";

/** Nueva solicitud de reposición (la abre Compras). */
export function NewReplenishmentForm({ suppliers }: { suppliers: SupplierOption[] }) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [productName, setProductName] = React.useState("");
  const [productRef, setProductRef] = React.useState("");
  const [clientOrBrand, setClientOrBrand] = React.useState("");
  const [neededBy, setNeededBy] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [npd, setNpd] = React.useState<{ id: string; label: string } | null>(null);
  const [items, setItems] = React.useState<Item[]>([blank()]);
  const [sendSupplier, setSendSupplier] = React.useState<boolean | null>(null);
  const [message, setMessage] = React.useState(DEFAULT_MESSAGE);
  const [preview, setPreview] = React.useState<{ key: string; emails: RepEmail[] } | null>(null);
  const [busy, setBusy] = React.useState<"preview" | "create" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [invalid, setInvalid] = React.useState<string | null>(null);
  const created = React.useRef(false);
  const dirty = !!(title || productName || productRef || clientOrBrand || neededBy || notes || npd || items.some((i) => i.description || i.quantity || i.supplierId));

  // Aviso al salir de la página con la solicitud a medias
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (created.current) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const payload = React.useMemo(
    () => ({
      template: "repeticion" as const,
      title,
      npdProjectId: npd?.id ?? null,
      productName: productName || null,
      productRef: productRef || null,
      clientOrBrand: clientOrBrand || null,
      neededBy: neededBy || null,
      notes: notes || null,
      sendSupplierEmails: !!sendSupplier,
      supplierMessage: message,
      items: items.map((i) => ({
        element: i.element,
        description: i.description || null,
        quantity: i.quantity ? Number(i.quantity) : null,
        supplierId: i.supplierId && i.supplierId !== NEW ? Number(i.supplierId) : null,
        newSupplier: i.supplierId === NEW && i.newName.trim() ? { name: i.newName.trim(), email: i.newEmail.trim() } : null,
      })),
    }),
    [title, npd, productName, productRef, clientOrBrand, neededBy, notes, sendSupplier, message, items],
  );
  const payloadKey = JSON.stringify(payload);
  const previewFresh = preview?.key === payloadKey;

  const setItem = (key: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  /** Primer error del formulario y el campo al que llevar el foco. */
  function check(): [string, string] | null {
    if (!title.trim()) return ["Pon un título a la reposición", "r-title"];
    for (const [n, i] of items.entries()) {
      if (!i.supplierId) return [`Indica el proveedor del elemento ${n + 1}`, `${i.key}-sup`];
      if (i.supplierId === NEW && !i.newName.trim()) return [`Escribe el nombre del proveedor nuevo (elemento ${n + 1})`, `${i.key}-nn`];
      if (i.element === "otro" && !i.description.trim()) return [`Describe el elemento ${n + 1} («Otro»)`, `${i.key}-desc`];
    }
    if (sendSupplier === null) return ["Indica si quieres enviar el email de recotización al proveedor", "send-supplier-yes"];
    return null;
  }
  const inv = (id: string) => (invalid === id ? true : undefined);

  async function doPreview() {
    const err = check();
    setError(err?.[0] ?? null);
    setInvalid(err?.[1] ?? null);
    if (err) {
      const el = document.getElementById(err[1]);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus({ preventScroll: true });
      return;
    }
    setBusy("preview");
    const res = await previewReplenishmentEmailsAction(payload);
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setPreview({ key: payloadKey, emails: res.data ?? [] });
    setTimeout(() => document.getElementById("rep-preview")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  async function create() {
    setBusy("create");
    const res = await createReplenishmentAction(payload);
    if (!res.ok) {
      setBusy(null);
      return setError(res.error);
    }
    created.current = true;
    toast.success(`Reposición ${res.data!.code} creada`);
    router.push(`/reposiciones/${res.data!.id}`);
  }

  async function preload() {
    if (!npd) return;
    const res = await lastItemsForProjectAction(npd.id);
    if (!res.ok) return toast.error(res.error);
    if (!res.data) return toast.info("Este proyecto no tiene reposiciones anteriores");
    setItems(
      res.data.items.map((i) => ({ ...blank(), element: i.element, description: i.description ?? "", quantity: i.quantity ? String(i.quantity) : "", supplierId: i.supplierId ? String(i.supplierId) : "" })),
    );
    toast.success(`Elementos y proveedores copiados de ${res.data.code}`);
  }

  const tpl = REPLENISHMENT_TEMPLATES.repeticion;
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Plantilla</p>
        <div className="mt-2 rounded-lg bg-[#eef0e6] px-3 py-2 ring-1 ring-natu-sage">
          <p className="text-sm font-semibold text-[#56613f]">{tpl.label}</p>
          <p className="text-xs text-[#56613f]">{tpl.description}</p>
        </div>
      </Card>

      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <h2 className="text-sm font-semibold text-slate-900 sm:col-span-2">Producto a reponer</h2>
        <Field label="Título de la reposición" required htmlFor="r-title" className="sm:col-span-2">
          <Input id="r-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="p. ej. Reposición etiquetas Bruma 100 ml…" maxLength={200} aria-invalid={inv("r-title")} />
        </Field>
        <Field label="Proyecto NPD de origen" hint="Opcional. Vincula el desarrollo original para tener a mano su ficha." className="sm:col-span-2">
          <ProjectPicker value={npd} onChange={setNpd} />
          {npd && (
            <button type="button" onClick={preload} className="mt-1 inline-flex items-center gap-1 self-start text-xs font-medium text-brand-600 hover:text-brand-800">
              <History className="size-3.5" /> Copiar elementos y proveedores de su última reposición
            </button>
          )}
        </Field>
        <Field label="Producto" htmlFor="r-prod">
          <Input id="r-prod" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Nombre comercial…" maxLength={200} />
        </Field>
        <Field label="Referencia / EAN" htmlFor="r-ref">
          <Input id="r-ref" value={productRef} onChange={(e) => setProductRef(e.target.value)} maxLength={100} />
        </Field>
        <Field label="Cliente / marca" htmlFor="r-client">
          <Input id="r-client" value={clientOrBrand} onChange={(e) => setClientOrBrand(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Fecha necesaria" htmlFor="r-date">
          <Input id="r-date" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
        </Field>
        <Field label="Notas para Diseño y Calidad" htmlFor="r-notes" className="sm:col-span-2">
          <Textarea id="r-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Cambios conocidos, lote, observaciones…" maxLength={4000} />
        </Field>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-900">Elementos a reponer</h2>
        <p className="mb-3 text-xs text-slate-500">Indica qué hay que reponer y el proveedor de cada elemento. Si el proveedor es nuevo, dalo de alta aquí mismo.</p>
        <ul className="flex flex-col gap-2">
          {items.map((i, n) => {
            const sup = suppliers.find((s) => String(s.id) === i.supplierId);
            return (
              <li key={i.key} className="rounded-lg border border-slate-200 p-3">
                <div className="grid gap-2 sm:grid-cols-[10rem_1fr_7rem_14rem_auto] sm:items-end">
                  <Field label={`Elemento ${n + 1}`} htmlFor={`${i.key}-el`}>
                    <Select id={`${i.key}-el`} value={i.element} onChange={(e) => setItem(i.key, { element: e.target.value })}>
                      {ELEMENTS.map((x) => (
                        <option key={x.key} value={x.key}>
                          {x.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Descripción" required={i.element === "otro"} htmlFor={`${i.key}-desc`}>
                    <Input id={`${i.key}-desc`} value={i.description} onChange={(e) => setItem(i.key, { description: e.target.value })} placeholder="Versión, medidas, idioma…" maxLength={300} aria-invalid={inv(`${i.key}-desc`)} />
                  </Field>
                  <Field label="Cantidad" htmlFor={`${i.key}-qty`}>
                    <Input id={`${i.key}-qty`} type="number" min={1} value={i.quantity} onChange={(e) => setItem(i.key, { quantity: e.target.value })} placeholder="5000…" className="tabular-nums" />
                  </Field>
                  <Field label="Proveedor" required htmlFor={`${i.key}-sup`}>
                    <Select id={`${i.key}-sup`} value={i.supplierId} onChange={(e) => setItem(i.key, { supplierId: e.target.value })} aria-invalid={inv(`${i.key}-sup`)}>
                      <option value="">Elige proveedor…</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                      <option value={NEW}>+ Nuevo proveedor…</option>
                    </Select>
                  </Field>
                  <button
                    type="button"
                    onClick={() => setItems((l) => l.filter((x) => x.key !== i.key))}
                    disabled={items.length === 1}
                    className="mb-1 rounded p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                    aria-label={`Quitar elemento ${n + 1}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {sup && <p className="mt-1 text-xs text-slate-500">{sup.emails.length ? sup.emails.join(", ") : <span className="text-amber-700">Este proveedor no tiene email</span>}</p>}
                {i.supplierId === NEW && (
                  <div className="mt-2 grid gap-2 rounded-md bg-slate-50 p-2 sm:grid-cols-2">
                    <Field label="Nombre del proveedor nuevo" required htmlFor={`${i.key}-nn`}>
                      <Input id={`${i.key}-nn`} value={i.newName} onChange={(e) => setItem(i.key, { newName: e.target.value })} maxLength={200} autoComplete="off" aria-invalid={inv(`${i.key}-nn`)} />
                    </Field>
                    <Field label="Email del proveedor" hint="Para enviarle la solicitud de recotización." htmlFor={`${i.key}-ne`}>
                      <Input id={`${i.key}-ne`} type="email" value={i.newEmail} onChange={(e) => setItem(i.key, { newEmail: e.target.value })} spellCheck={false} autoComplete="off" placeholder="pedidos@proveedor.com…" />
                    </Field>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <button type="button" onClick={() => setItems((l) => [...l, blank()])} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-800">
          <Plus className="size-3.5" /> Añadir elemento
        </button>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-900">Emails automáticos</h2>
        <p className="mb-3 text-xs text-slate-500">
          Al crear la reposición se avisa a <strong>Diseño</strong> (revisa si hay cambios y prepara el arte final) y a <strong>Calidad</strong> (lo validará después).
        </p>
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">
            ¿Enviar email al proveedor pidiendo la recotización de materiales? <span className="text-rose-600">*</span>
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              [true, "Sí, enviar al proveedor"],
              [false, "No es necesario"],
            ].map(([v, l]) => (
              <label
                key={String(v)}
                className={cn(
                  "cursor-pointer rounded-lg px-3 py-2 text-sm ring-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 has-[:focus-visible]:ring-offset-2",
                  sendSupplier === v ? "bg-natu-dark text-white ring-natu-dark" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50",
                )}
              >
                <input
                  type="radio"
                  name="send-supplier"
                  id={v ? "send-supplier-yes" : "send-supplier-no"}
                  className="sr-only"
                  checked={sendSupplier === v}
                  onChange={() => setSendSupplier(v as boolean)}
                />
                {l as string}
              </label>
            ))}
          </div>
        </fieldset>
        {sendSupplier && (
          <Field label="Mensaje para el proveedor" htmlFor="r-msg" className="mt-3" hint="Se incluye en el email junto con los materiales, cantidades y la fecha. El proveedor responde directamente a Compras.">
            <Textarea id="r-msg" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} className="min-h-24" />
          </Field>
        )}
      </Card>

      {preview && (
        <Card id="rep-preview" className="scroll-mt-20 p-4">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Revisa los emails antes de crear la reposición</h2>
            {!previewFresh && <span className="text-xs text-amber-700">Has cambiado datos: vuelve a revisar los emails.</span>}
          </div>
          <EmailPreview emails={preview.emails} />
        </Card>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <X className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 pb-8">
        <Button variant="secondary" onClick={doPreview} disabled={!!busy}>
          {busy === "preview" ? <Loader2 className="animate-spin" /> : <Eye />} {preview ? "Actualizar vista previa" : "Revisar emails"}
        </Button>
        <Button onClick={create} disabled={!!busy || !previewFresh} title={!previewFresh ? "Revisa primero los emails que se enviarán" : undefined}>
          {busy === "create" && <Loader2 className="animate-spin" />} Crear reposición
        </Button>
      </div>
    </div>
  );
}

/** Buscador de proyectos NPD (código o nombre), con teclado: ↑ ↓ Intro y Esc. */
function ProjectPicker({ value, onChange }: { value: { id: string; label: string } | null; onChange: (v: { id: string; label: string } | null) => void }) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<{ id: string; label: string }[]>([]);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const listId = React.useId();
  React.useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const res = await searchNpdProjectsAction(q);
      if (res.ok) {
        setResults(res.data ?? []);
        setActive(0);
        setOpen(true);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const pick = (r: { id: string; label: string }) => {
    onChange(r);
    setOpen(false);
    setQ("");
  };
  if (value)
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
        <span className="truncate">{value.label}</span>
        <button type="button" onClick={() => onChange(null)} className="rounded p-0.5 text-slate-500 hover:bg-slate-200" aria-label="Quitar proyecto">
          <X className="size-4" />
        </button>
      </div>
    );
  const shown = open && q.trim().length >= 2;
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" aria-hidden />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") return setOpen(false);
          if (!shown || !results.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(results[active]!);
          }
        }}
        placeholder="Busca por código o nombre (p. ej. 2026-PL-0007)…"
        className="pl-9"
        aria-label="Buscar proyecto NPD"
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && results.length ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
      />
      {shown && (
        <ul id={listId} role="listbox" aria-label="Proyectos NPD" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200">
          {results.length ? (
            results.map((r, i) => (
              <li
                key={r.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
                className={cn("cursor-pointer px-3 py-1.5", i === active && "bg-slate-100")}
              >
                {r.label}
              </li>
            ))
          ) : (
            <li className="px-3 py-1.5 text-slate-500" role="option" aria-selected={false} aria-disabled>
              Sin resultados
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
