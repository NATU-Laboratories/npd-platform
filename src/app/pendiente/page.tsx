import { redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { signOut } from "@/auth";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { getCurrentUser, isActive } from "@/lib/server/authz";

export const metadata = { title: "Pendiente de activación" };

export default async function PendingPage() {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (isActive(u)) redirect("/");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow">
        <Logo className="text-brand-700" />
        <Clock className="mx-auto mt-8 size-10 text-amber-500" />
        <h1 className="mt-4 text-lg font-semibold">{u.status === "disabled" ? "Usuario desactivado" : "Pendiente de activación"}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {u.status === "disabled"
            ? "Tu acceso a la plataforma está desactivado."
            : `Hola ${u.name}. Tu cuenta aún no tiene roles asignados. El administrador ha recibido un aviso y te dará acceso en breve.`}
        </p>
        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <Button variant="secondary" type="submit">
            Cerrar sesión
          </Button>
        </form>
      </div>
    </main>
  );
}
