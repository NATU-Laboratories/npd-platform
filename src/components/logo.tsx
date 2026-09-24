import Image from "next/image";
import logoDark from "../../public/brand/natu-logo-dark.png";
import logoWhite from "../../public/brand/natu-logo-white.png";

/** Logotipo NATU Laboratories + nombre de la herramienta. `onDark` usa la versión blanca. */
export function Logo({ onDark = false, className = "" }: { onDark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <Image src={onDark ? logoWhite : logoDark} alt="NATU Laboratories" priority className="h-9 w-auto" />
      <span className={`h-7 w-px ${onDark ? "bg-white/30" : "bg-slate-300"}`} aria-hidden />
      <span className={`text-[11px] font-semibold uppercase leading-tight tracking-[0.2em] ${onDark ? "text-white/85" : "text-slate-600"}`}>
        Proyectos
        <br />
        NPD
      </span>
    </span>
  );
}
