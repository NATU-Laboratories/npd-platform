import Link from "next/link";
import { requireAdmin } from "@/lib/server/authz";

const NAV = [
  ["/admin", "Resumen"],
  ["/admin/usuarios", "Usuarios"],
  ["/admin/departamentos", "Departamentos"],
  ["/admin/decisores", "Decisores por puerta"],
  ["/admin/catalogos", "Catálogos"],
  ["/admin/plantillas", "Plantillas de flujo"],
  ["/admin/configuracion", "Configuración"],
  ["/admin/actividad", "Registro de actividad"],
  ["/admin/errores", "Logs de errores"],
  ["/admin/notificaciones", "Notificaciones"],
  ["/admin/uso", "Uso"],
] as const;

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <nav className="flex gap-1 overflow-x-auto lg:w-52 lg:shrink-0 lg:flex-col" aria-label="Backoffice">
        <p className="hidden px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 lg:block">Backoffice</p>
        {NAV.map(([href, label]) => (
          <Link key={href} href={href} className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-slate-700 hover:bg-white hover:shadow-sm">
            {label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
