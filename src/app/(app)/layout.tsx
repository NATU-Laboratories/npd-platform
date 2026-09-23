import Link from "next/link";
import { LogOut, Plus, Settings } from "lucide-react";
import { signOut } from "@/auth";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { canRequest, isAdmin, requireUser } from "@/lib/server/authz";
import { ROLE_LABEL } from "@/lib/labels";
import { initials } from "@/lib/utils";
import { newDraftAction } from "@/app/actions/projects";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const u = await requireUser();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 bg-brand-700 text-white shadow">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <Link href="/" className="shrink-0">
            <Logo />
          </Link>
          <nav className="ml-4 hidden items-center gap-1 text-sm sm:flex">
            <Link href="/" className="rounded px-3 py-1.5 hover:bg-white/10">
              Panel
            </Link>
            {isAdmin(u) && (
              <Link href="/admin" className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 hover:bg-white/10">
                <Settings className="size-4" /> Backoffice
              </Link>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {canRequest(u) && (
              <form action={newDraftAction}>
                <Button type="submit" size="sm" className="bg-white text-brand-800 hover:bg-brand-50">
                  <Plus /> <span className="hidden sm:inline">Nueva solicitud</span>
                  <span className="sm:hidden">Nueva</span>
                </Button>
              </form>
            )}
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center rounded-full bg-white/15 size-8 justify-center text-xs font-semibold hover:bg-white/25" title={u.name}>
                {initials(u.name)}
              </summary>
              <div className="absolute right-0 mt-2 w-64 rounded-lg bg-white p-3 text-sm text-slate-700 shadow-lg ring-1 ring-slate-200">
                <p className="font-medium text-slate-900">{u.name}</p>
                <p className="truncate text-xs text-slate-500">{u.email}</p>
                <p className="mt-2 text-xs text-slate-500">{u.roles.map((r) => ROLE_LABEL[r]).join(" · ")}</p>
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
    </div>
  );
}
