"use client";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteSupplierAction } from "@/app/actions/admin";

export function DeleteSupplierButton({ id, name, used }: { id: number; name: string; used: number }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="ml-1 rounded p-1.5 align-middle text-slate-400 hover:bg-rose-50 hover:text-rose-600"
      aria-label={`Eliminar ${name}`}
      title="Eliminar"
      onClick={async () => {
        const msg = used ? `«${name}» se usa en reposiciones: se desactivará para no perder el historial. ¿Continuar?` : `¿Eliminar el proveedor «${name}»?`;
        if (!window.confirm(msg)) return;
        const res = await deleteSupplierAction(id);
        if (!res.ok) return toast.error(res.error ?? "No se ha podido eliminar");
        toast.success(res.deactivated ? "Proveedor desactivado" : "Proveedor eliminado");
        router.refresh();
      }}
    >
      <Trash2 className="size-4" />
    </button>
  );
}
