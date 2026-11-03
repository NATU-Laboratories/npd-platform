"use client";
import { Copy, Loader2, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { deleteTemplateAction, duplicateTemplateAction, toggleTemplateAction } from "@/app/actions/templates";

export function TemplateRowActions({ id, name, isActive, usedIn }: { id: number; name: string; isActive: boolean; usedIn: number }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  async function run(kind: string, fn: () => Promise<{ ok: boolean; error?: string; id?: number }>, done: string) {
    setBusy(kind);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return toast.error(res.error ?? "No se ha podido completar");
    toast.success(done);
    if (kind === "dup" && res.id) router.push(`/admin/plantillas/${res.id}`);
    else router.refresh();
  }
  const icon = "rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50";
  return (
    <div className="flex items-center gap-1">
      <label className="mr-2 inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
        <input
          type="checkbox"
          className="size-4 accent-brand-600"
          checked={isActive}
          disabled={!!busy}
          onChange={(e) => run("toggle", () => toggleTemplateAction(id, e.target.checked), e.target.checked ? "Plantilla activada" : "Plantilla desactivada")}
        />
        Activa
      </label>
      <Link href={`/admin/plantillas/${id}`} className={icon} title="Editar" aria-label={`Editar ${name}`}>
        <Pencil className="size-4" />
      </Link>
      <button type="button" className={icon} disabled={!!busy} title="Duplicar" aria-label={`Duplicar ${name}`} onClick={() => run("dup", () => duplicateTemplateAction(id), "Plantilla duplicada")}>
        {busy === "dup" ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
      </button>
      <button
        type="button"
        className={`${icon} hover:bg-rose-50 hover:text-rose-600`}
        disabled={!!busy}
        title="Eliminar"
        aria-label={`Eliminar ${name}`}
        onClick={() => {
          const extra = usedIn ? `\n\nSe usó en ${usedIn} ${usedIn === 1 ? "proyecto" : "proyectos"}: no les afecta (sus departamentos ya están asignados).` : "";
          if (window.confirm(`¿Eliminar la plantilla «${name}» y todas sus tareas? No se puede deshacer.${extra}`))
            void run("del", () => deleteTemplateAction(id), "Plantilla eliminada");
        }}
      >
        {busy === "del" ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      </button>
    </div>
  );
}
