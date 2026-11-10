"use client";
import { Loader2, Lock, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { saveFormulaCostAction } from "@/app/actions/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";

/** Coste objetivo de la fórmula (confidencial). Solo se renderiza para quien puede verlo. */
export function FormulaCostBox({ projectId, value }: { projectId: string; value: number | null }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [v, setV] = React.useState(value != null ? String(value) : "");
  const [busy, setBusy] = React.useState(false);

  async function save() {
    setBusy(true);
    const res = await saveFormulaCostAction(projectId, v.trim() ? Number(v.replace(",", ".")) : null);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Coste objetivo guardado");
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2 text-sm">
      <span className="flex items-center gap-1.5 font-medium text-amber-900">
        <Lock className="size-3.5" aria-hidden /> Coste objetivo de la fórmula
      </span>
      {editing ? (
        <span className="flex items-center gap-2">
          <Input
            aria-label="Coste objetivo de la fórmula"
            type="number"
            inputMode="decimal"
            step="0.0001"
            min={0}
            value={v}
            onChange={(e) => setV(e.target.value)}
            className="h-8 max-w-32"
          />
          <span className="text-slate-500">€/litro</span>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Guardar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </span>
      ) : (
        <>
          <span className="tabular-nums text-slate-900">{value != null ? `${value.toLocaleString("es-ES", { maximumFractionDigits: 4 })} €/litro` : "Sin indicar"}</span>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil /> Editar
          </Button>
        </>
      )}
      <span className="w-full text-xs text-amber-900/80">Confidencial: solo lo ven Laboratorio / I+D, el gestor de proyectos y Operaciones.</span>
    </div>
  );
}
