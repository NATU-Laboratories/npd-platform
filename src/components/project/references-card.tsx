"use client";
import { Layers, Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { deleteReferenceAction, renameReferenceAction, setReferenceCountAction } from "@/app/actions/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";

type Ref = { id: number; label: string; name: string; unitPrice: number | null; finalUnitPrice: number | null };

const eur = (n: number | null) => (n == null ? "—" : n.toLocaleString("es-ES", { style: "currency", currency: "EUR" }));

/**
 * Referencias del proyecto (variantes). Con dos o más, fórmula, naming/EAN,
 * regulatorio y etiqueta van por referencia y cada departamento avanza por separado.
 */
export function ReferencesCard({
  projectId,
  refs,
  canManage,
  suggested,
  showPrices,
}: {
  projectId: string;
  refs: Ref[];
  canManage: boolean;
  /** Nº de referencias indicado en el brief (para proponer dividir). */
  suggested: number;
  showPrices: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [count, setCount] = React.useState(String(Math.max(2, suggested)));
  const multi = refs.length >= 2;

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Error");
    if (ok) toast.success(ok);
    router.refresh();
  }

  return (
    <Card id="referencias">
      <CardHeader
        title={multi ? `Referencias (${refs.length})` : "Referencias"}
        description={
          multi
            ? "Fórmula, naming y EAN, regulatorio y etiqueta van por referencia; cada departamento avanza cada una por separado."
            : "El proyecto se trabaja como una sola referencia."
        }
      />
      <CardBody className="flex flex-col gap-3">
        {multi ? (
          <ul className="flex flex-col divide-y divide-slate-100">
            {refs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">{r.label}</span>
                {canManage ? (
                  <Input
                    defaultValue={r.name}
                    aria-label={`Nombre de la referencia ${r.label}`}
                    className="h-8 max-w-64 text-sm"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== r.name) void act(() => renameReferenceAction(projectId, r.id, v));
                    }}
                  />
                ) : (
                  <span className="text-sm font-medium text-slate-900">{r.name}</span>
                )}
                {showPrices && (
                  <span className="text-xs text-slate-500">
                    Cotizado {eur(r.unitPrice)}
                    {r.finalUnitPrice != null ? ` · final ${eur(r.finalUnitPrice)}` : ""}
                  </span>
                )}
                {canManage && refs.length > 2 && (
                  <button
                    type="button"
                    className="ml-auto rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    aria-label={`Eliminar la referencia ${r.label}`}
                    title="Eliminar referencia (y sus datos)"
                    onClick={() => {
                      if (window.confirm(`¿Eliminar la referencia ${r.label} · ${r.name} y todos sus datos?`)) void act(() => deleteReferenceAction(projectId, r.id), "Referencia eliminada");
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          suggested >= 2 && <p className="text-sm text-amber-800">El brief indica {suggested} referencias.</p>
        )}
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            {multi ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => setReferenceCountAction(projectId, refs.length + 1), "Referencia añadida")}>
                {busy ? <Loader2 className="animate-spin" /> : <Plus />} Añadir referencia
              </Button>
            ) : (
              <>
                <Input type="number" min={2} max={26} value={count} onChange={(e) => setCount(e.target.value)} aria-label="Número de referencias" className="h-8 w-20 text-sm" />
                <Button size="sm" variant="secondary" disabled={busy || Number(count) < 2} onClick={() => act(() => setReferenceCountAction(projectId, Number(count)), "Proyecto dividido en referencias")}>
                  {busy ? <Loader2 className="animate-spin" /> : <Layers />} Dividir en referencias
                </Button>
              </>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
