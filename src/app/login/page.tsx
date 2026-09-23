import { redirect } from "next/navigation";
import { auth, devLoginEnabled, signIn } from "@/auth";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";

export const metadata = { title: "Iniciar sesión" };

const DEMO = [
  ["admin@natu.test", "Irene Admin"],
  ["comercial@natu.test", "Carlos Comercial"],
  ["marketing@natu.test", "Marta Marketing (decisora G1)"],
  ["idi@natu.test", "Luis Laboratorio"],
  ["direccion@natu.test", "Diego Dirección"],
  ["nuevo@natu.test", "Usuario sin rol"],
] as const;

const ERRORS: Record<string, string> = {
  disabled: "Tu usuario está desactivado. Contacta con el administrador.",
  AccessDenied: "Acceso denegado. Usa tu cuenta corporativa de Microsoft 365.",
  CredentialsSignin: "No se pudo iniciar sesión.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await auth();
  if (session?.user?.id) redirect("/");
  const { error } = await searchParams;
  const errorMsg = typeof error === "string" ? (ERRORS[error] ?? "No se pudo iniciar sesión.") : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-brand-700 to-brand-900 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <Logo className="text-brand-700" />
        <h1 className="mt-6 text-xl font-semibold text-slate-900">Gestión de nuevos desarrollos</h1>
        <p className="mt-1 text-sm text-slate-500">Accede con tu cuenta corporativa de Microsoft 365.</p>
        {errorMsg && <p className="mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{errorMsg}</p>}
        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signIn("microsoft-entra-id", { redirectTo: "/" });
          }}
        >
          <Button type="submit" size="lg" className="w-full">
            <svg viewBox="0 0 21 21" aria-hidden className="size-4">
              <rect x="1" y="1" width="9" height="9" fill="#f25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
            Entrar con Microsoft
          </Button>
        </form>

        {devLoginEnabled && (
          <div className="mt-8 border-t border-dashed border-slate-200 pt-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Login de desarrollo</p>
            <form
              className="mt-3 flex gap-2"
              action={async (fd: FormData) => {
                "use server";
                await signIn("dev", { email: fd.get("email"), redirectTo: "/" });
              }}
            >
              <Input name="email" type="email" placeholder="email@natu.test" required aria-label="Email" />
              <Button type="submit" variant="secondary">
                Entrar
              </Button>
            </form>
            <div className="mt-3 flex flex-col gap-1">
              {DEMO.map(([email, name]) => (
                <form
                  key={email}
                  action={async () => {
                    "use server";
                    await signIn("dev", { email, name: name.replace(/ \(.*\)$/, ""), redirectTo: "/" });
                  }}
                >
                  <button type="submit" className="w-full rounded px-2 py-1 text-left text-sm text-slate-600 hover:bg-slate-50">
                    {name} <span className="text-slate-400">· {email}</span>
                  </button>
                </form>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
