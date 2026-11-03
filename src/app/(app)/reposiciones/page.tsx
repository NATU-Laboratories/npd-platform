import { Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { REP_STATUS_COLOR, REP_STATUS_LABEL } from "@/lib/replenishment/config";
import { requireUser } from "@/lib/server/authz";
import { canAccessReplenishments, canCreateReplenishment, listReplenishments, myTurn } from "@/lib/server/replenishments";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Reposiciones" };

export default async function ReplenishmentsPage({ searchParams }: PageProps<"/reposiciones">) {
  const u = await requireUser();
  if (!canAccessReplenishments(u)) redirect("/");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const status = one("estado") ?? "abiertas";
  const rows = await listReplenishments(u, { q: one("q"), status: status === "todas" ? undefined : status, mine: one("mias") === "1" });
  const mine = rows.filter((r) => myTurn(u, r));
  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-500">
            <RefreshCw className="size-3.5" /> Reposiciones
          </p>
          <h1 className="text-xl font-semibold text-slate-900">Reposiciones de productos ya desarrollados</h1>
          <p className="mt-0.5 text-sm text-slate-500">Compras abre la solicitud, Diseño revisa y prepara el arte final, Calidad lo valida y Compras lo envía a imprenta.</p>
        </div>
        {canCreateReplenishment(u) && (
          <Button asChild>
            <Link href="/reposiciones/nueva">
              <Plus /> Nueva reposición
            </Link>
          </Button>
        )}
      </div>

      {mine.length > 0 && (
        <div className="mb-4 rounded-xl bg-[#eef0e6] px-4 py-3 text-sm text-[#56613f] ring-1 ring-natu-sage">
          <strong>Te toca en {mine.length} {mine.length === 1 ? "reposición" : "reposiciones"}:</strong>{" "}
          {mine.slice(0, 5).map((r, i) => (
            <span key={r.id}>
              {i > 0 && ", "}
              <Link href={`/reposiciones/${r.id}`} className="font-medium underline underline-offset-2">
                {r.code}
              </Link>{" "}
              ({REP_STATUS_LABEL[r.status].toLowerCase()})
            </span>
          ))}
          {mine.length > 5 && "…"}
        </div>
      )}

      <form className="mb-4 flex flex-wrap items-center gap-2" action="/reposiciones">
        <Input name="q" defaultValue={one("q")} placeholder="Buscar código, producto, referencia, cliente…" className="w-72" aria-label="Buscar" />
        <Select name="estado" defaultValue={status} className="w-56" aria-label="Estado">
          <option value="abiertas">Abiertas</option>
          <option value="todas">Todas</option>
          {Object.entries(REP_STATUS_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input type="checkbox" name="mias" value="1" defaultChecked={one("mias") === "1"} className="size-4 accent-brand-600" /> Solo las mías
        </label>
        <Button type="submit" variant="secondary" size="sm">
          Filtrar
        </Button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <th className="px-3 py-2 font-medium">Código</th>
              <th className="px-3 py-2 font-medium">Reposición</th>
              <th className="px-3 py-2 font-medium">Elementos</th>
              <th className="px-3 py-2 font-medium">Proveedores</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">Recotización</th>
              <th className="px-3 py-2 font-medium">Fecha necesaria</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn("border-b border-slate-100 align-top hover:bg-slate-50", myTurn(u, r) && "bg-[#f7f8f2]")}>
                <td className="whitespace-nowrap px-3 py-2">
                  <Link href={`/reposiciones/${r.id}`} className="font-medium text-slate-900 hover:underline">
                    {r.code}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <Link href={`/reposiciones/${r.id}`} className="hover:underline">
                    {r.title}
                  </Link>
                  <p className="text-xs text-slate-500">{[r.productName, r.clientOrBrand, r.requester].filter(Boolean).join(" · ")}</p>
                </td>
                <td className="px-3 py-2 text-xs">{r.elements.join(", ")}</td>
                <td className="px-3 py-2 text-xs">{r.suppliers.join(", ") || "—"}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs ring-1", REP_STATUS_COLOR[r.status])}>{REP_STATUS_LABEL[r.status]}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{r.quotesPending ? `${r.quotesPending} pendiente${r.quotesPending > 1 ? "s" : ""}` : "Recibida"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{r.neededBy ? formatDate(r.neededBy) : "—"}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-500">
                  No hay reposiciones {status === "abiertas" ? "abiertas" : "con estos filtros"}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
