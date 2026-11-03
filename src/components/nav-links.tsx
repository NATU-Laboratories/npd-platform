"use client";
import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { newDraftAction } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const isRep = (p: string) => p.startsWith("/reposiciones");

/** Pestañas de la cabecera: Nuevos desarrollos (NPD) y Reposiciones. */
export function MainNav({ showReplenishments }: { showReplenishments: boolean }) {
  const path = usePathname();
  const npd = path === "/" || path.startsWith("/proyectos");
  const tab = (active: boolean) => cn("rounded px-3 py-1.5 hover:bg-white/10", active && "bg-white/15 font-medium");
  return (
    <>
      <Link href="/" className={tab(npd)} aria-current={npd ? "page" : undefined}>
        <span className="hidden md:inline">Nuevos desarrollos</span>
        <span className="md:hidden">NPD</span>
      </Link>
      {showReplenishments && (
        <Link href="/reposiciones" className={tab(isRep(path))} aria-current={isRep(path) ? "page" : undefined}>
          Reposiciones
        </Link>
      )}
    </>
  );
}

/** Botón principal de la cabecera según el apartado en el que se está. */
export function HeaderNewButton({ canNpd, canRep }: { canNpd: boolean; canRep: boolean }) {
  const path = usePathname();
  const cls = "bg-natu-sage font-semibold text-natu-dark hover:bg-brand-300";
  if (isRep(path)) {
    if (!canRep || path === "/reposiciones/nueva") return null;
    return (
      <Button asChild size="sm" className={cls}>
        <Link href="/reposiciones/nueva">
          <Plus /> <span className="hidden sm:inline">Nueva reposición</span>
          <span className="sm:hidden">Nueva</span>
        </Link>
      </Button>
    );
  }
  if (!canNpd) return null;
  return (
    <form action={newDraftAction}>
      <Button type="submit" size="sm" className={cls}>
        <Plus /> <span className="hidden sm:inline">Nueva solicitud</span>
        <span className="sm:hidden">Nueva</span>
      </Button>
    </form>
  );
}
