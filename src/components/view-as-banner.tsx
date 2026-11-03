import { Eye } from "lucide-react";
import { stopViewAsAction } from "@/app/actions/admin";

/** Franja del modo «Ver como»: el admin ve la plataforma como otro usuario, en solo lectura. */
export function ViewAsBanner({ name, adminName }: { name: string; adminName: string }) {
  return (
    <div className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-brand-500 px-4 py-1.5 text-center text-xs font-medium text-white">
      <span className="inline-flex items-center gap-1.5">
        <Eye className="size-3.5" aria-hidden /> Vista previa como <strong>{name}</strong> (solo lectura) · {adminName}
      </span>
      <form action={stopViewAsAction}>
        <button type="submit" className="rounded bg-white/20 px-2 py-0.5 hover:bg-white/30">
          Salir de la vista previa
        </button>
      </form>
    </div>
  );
}
