import Link from "next/link";
import { LogOut, Settings } from "lucide-react";
import { devLoginEnabled, signOut } from "@/auth";
import { Logo } from "@/components/logo";
import { ViewAsBanner } from "@/components/view-as-banner";
import { AssistantWidget } from "@/components/assistant/assistant-widget";
import { assistantEnabled } from "@/lib/server/assistant";
import { HeaderNewButton, MainNav } from "@/components/nav-links";
import { canAccessReplenishments, canCreateReplenishment } from "@/lib/server/replenishments";
import { canRequest, isAdmin, requireUser } from "@/lib/server/authz";
import { EDITABLE_ROLES, ROLE_LABEL } from "@/lib/labels";
import { initials } from "@/lib/utils";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const u = await requireUser();
  return (
    <div className="flex min-h-dvh flex-col">
      {u.viewAs && <ViewAsBanner name={u.name} adminName={u.viewAs.adminName} />}
      {devLoginEnabled && (
        <div className="bg-amber-400 px-4 py-1 text-center text-xs font-medium text-amber-950">
          Modo pruebas: acceso provisional sin Microsoft. Los emails no se envían y los archivos no van a SharePoint.
        </div>
      )}
      <header className="sticky top-0 z-30 bg-natu-dark text-white shadow-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:h-16 sm:gap-3 sm:px-4">
          <Link href="/" className="shrink-0">
            <Logo onDark />
          </Link>
          <nav className="ml-1 flex min-w-0 items-center gap-0.5 text-sm sm:ml-4 sm:gap-1">
            <MainNav showReplenishments={canAccessReplenishments(u)} />
            {isAdmin(u) && (
              <Link href="/admin" className="hidden items-center gap-1.5 rounded px-3 py-1.5 hover:bg-white/10 sm:inline-flex">
                <Settings className="size-4" /> Backoffice
              </Link>
            )}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <HeaderNewButton canNpd={canRequest(u)} canRep={canCreateReplenishment(u)} />
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center rounded-full bg-white/15 size-8 justify-center text-xs font-semibold hover:bg-white/25" title={u.name}>
                {initials(u.name)}
              </summary>
              <div className="absolute right-0 mt-2 w-64 rounded-lg bg-white p-3 text-sm text-slate-700 shadow-lg ring-1 ring-slate-200">
                <p className="font-medium text-slate-900">{u.name}</p>
                <p className="truncate text-xs text-slate-500">{u.email}</p>
                <p className="mt-2 text-xs text-slate-500">{u.roles.filter((r) => (EDITABLE_ROLES as readonly string[]).includes(r)).map((r) => ROLE_LABEL[r]).join(" · ")}</p>
                {isAdmin(u) && (
                  <Link href="/admin" className="mt-2 block rounded px-2 py-1.5 hover:bg-slate-50 sm:hidden">
                    Backoffice
                  </Link>
                )}
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/login" });
                  }}
                >
                  <button type="submit" className="mt-2 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-slate-50">
                    <LogOut className="size-4" /> Cerrar sesión
                  </button>
                </form>
              </div>
            </details>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
      {/* Asistente virtual (solo si está configurada la clave de la API de OpenAI) */}
      {assistantEnabled() && <AssistantWidget firstName={u.name.split(" ")[0] ?? u.name} />}
    </div>
  );
}
