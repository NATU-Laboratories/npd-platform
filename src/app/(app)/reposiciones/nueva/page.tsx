import { asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { NewReplenishmentForm } from "@/components/replenishment/new-form";
import { requireUser } from "@/lib/server/authz";
import { canCreateReplenishment } from "@/lib/server/replenishments";

export const metadata = { title: "Nueva reposición" };

export default async function NewReplenishmentPage() {
  const u = await requireUser();
  if (!canCreateReplenishment(u)) redirect("/reposiciones");
  const list = await db.select({ id: suppliers.id, name: suppliers.name, emails: suppliers.emails }).from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name));
  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/reposiciones" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Reposiciones
      </Link>
      <h1 className="text-xl font-semibold text-slate-900">Nueva reposición</h1>
      <p className="mb-5 mt-0.5 text-sm text-slate-500">Reposición de un producto ya desarrollado. Indica qué elementos hay que reponer y su proveedor.</p>
      <NewReplenishmentForm suppliers={list} />
    </div>
  );
}
