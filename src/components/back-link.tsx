"use client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import * as React from "react";

/** Clave donde el panel recuerda su última dirección (con filtros) para poder volver a ella. */
export const PANEL_URL_KEY = "npd:panel-url";

/** «← Nuevos desarrollos»: vuelve al panel con los filtros que tenía. */
export function BackLink({ label = "Nuevos desarrollos" }: { label?: string }) {
  const [href, setHref] = React.useState("/");
  React.useEffect(() => {
    try {
      const saved = sessionStorage.getItem(PANEL_URL_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage solo existe en el navegador
      if (saved?.startsWith("/")) setHref(saved);
    } catch {}
  }, []);
  return (
    <Link href={href} className="inline-flex items-center gap-1 self-start rounded-md py-1 pr-2 text-sm text-slate-500 hover:text-slate-900">
      <ArrowLeft className="size-4" aria-hidden /> {label}
    </Link>
  );
}
