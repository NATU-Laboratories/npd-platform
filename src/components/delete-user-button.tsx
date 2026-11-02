"use client";
import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { deleteUserAction } from "@/app/actions/admin";

/** Eliminar usuario (Backoffice). Solo se borra si no tiene actividad en proyectos. */
export function DeleteUserButton({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  async function onClick() {
    if (!window.confirm(`¿Eliminar a ${name}? Esta acción no se puede deshacer.`)) return;
    setBusy(true);
    const res = await deleteUserAction(userId);
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "No se ha podido eliminar");
    toast.success(`${name} eliminado`);
    router.refresh();
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={`Eliminar a ${name}`}
      aria-label={`Eliminar a ${name}`}
      className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
    </button>
  );
}
