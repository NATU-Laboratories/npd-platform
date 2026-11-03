import { asc, count } from "drizzle-orm";
import { db } from "@/db";
import { replenishmentItems, suppliers } from "@/db/schema";
import { PageTitle, Table, Td, Th } from "@/components/admin";
import { DeleteSupplierButton } from "@/components/admin-templates/delete-supplier-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { saveSupplierAction } from "@/app/actions/admin";

export const metadata = { title: "Proveedores" };

export default async function SuppliersPage() {
  const [rows, usage] = await Promise.all([
    db.select().from(suppliers).orderBy(asc(suppliers.name)),
    db.select({ id: replenishmentItems.supplierId, n: count() }).from(replenishmentItems).groupBy(replenishmentItems.supplierId),
  ]);
  return (
    <>
      <PageTitle
        title="Proveedores"
        description="Proveedores de materiales para las reposiciones (etiquetas, estuches, envases…). Reciben los emails de recotización y responden a Compras. Varios emails separados por comas."
      />
      <Table>
        <thead>
          <tr>
            <Th>Proveedor</Th>
            <Th>Emails</Th>
            <Th>Contacto</Th>
            <Th>Teléfono</Th>
            <Th>Activo</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const used = usage.find((x) => x.id === s.id)?.n ?? 0;
            const f = `s${s.id}`;
            return (
              <tr key={s.id} className={s.isActive ? "" : "opacity-60"}>
                <Td>
                  <form id={f} action={saveSupplierAction}>
                    <input type="hidden" name="id" value={s.id} />
                  </form>
                  <Input name="name" form={f} defaultValue={s.name} className="h-8 min-w-40 text-sm" aria-label="Nombre" required />
                  {used > 0 && <p className="mt-0.5 text-[11px] text-slate-400">En {used} {used === 1 ? "elemento" : "elementos"} de reposiciones</p>}
                </Td>
                <Td>
                  <Input name="emails" form={f} defaultValue={s.emails.join(", ")} className="h-8 min-w-56 text-sm" aria-label="Emails" placeholder="sin email" />
                </Td>
                <Td>
                  <Input name="contactName" form={f} defaultValue={s.contactName ?? ""} className="h-8 min-w-32 text-sm" aria-label="Contacto" />
                </Td>
                <Td>
                  <Input name="phone" form={f} defaultValue={s.phone ?? ""} className="h-8 w-32 text-sm" aria-label="Teléfono" />
                </Td>
                <Td>
                  <input type="checkbox" name="isActive" form={f} defaultChecked={s.isActive} className="accent-brand-600" aria-label="Activo" />
                </Td>
                <Td className="whitespace-nowrap">
                  <Button size="sm" variant="secondary" type="submit" form={f}>
                    Guardar
                  </Button>
                  <DeleteSupplierButton id={s.id} name={s.name} used={used} />
                </Td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <Td className="text-slate-500">Todavía no hay proveedores. También se pueden dar de alta al crear una reposición.</Td>
            </tr>
          )}
        </tbody>
      </Table>
      <form action={saveSupplierAction} className="mt-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_1.4fr_1fr_8rem_auto]">
        <Input name="name" placeholder="Nuevo proveedor" required aria-label="Nombre del nuevo proveedor" />
        <Input name="emails" placeholder="Emails (separados por comas)" aria-label="Emails" />
        <Input name="contactName" placeholder="Persona de contacto" aria-label="Contacto" />
        <Input name="phone" placeholder="Teléfono" aria-label="Teléfono" />
        <Button type="submit" variant="secondary">
          Añadir
        </Button>
      </form>
    </>
  );
}
