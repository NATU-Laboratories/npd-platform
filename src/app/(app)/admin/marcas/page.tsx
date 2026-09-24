import { PageTitle, Table, Td, Th } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { saveBrandAction } from "@/app/actions/admin";
import { getBrands } from "@/lib/server/catalogs";

export const metadata = { title: "Marcas propias" };

export default async function BrandsPage() {
  const rows = await getBrands(false);
  return (
    <>
      <PageTitle title="Marcas propias" description="Marcas de NATU que aparecen al crear una solicitud de marca propia (MP)." />
      <Table>
        <thead>
          <tr>
            <Th>Marca</Th>
            <Th>Activa</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <Td>
                <form id={`b${b.id}`} action={saveBrandAction}>
                  <input type="hidden" name="id" value={b.id} />
                </form>
                <Input name="name" form={`b${b.id}`} defaultValue={b.name} className="h-8 text-sm" aria-label="Nombre de la marca" />
              </Td>
              <Td>
                <input type="checkbox" name="isActive" form={`b${b.id}`} defaultChecked={b.isActive} className="accent-brand-600" aria-label="Activa" />
              </Td>
              <Td>
                <Button size="sm" variant="secondary" type="submit" form={`b${b.id}`}>
                  Guardar
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <form action={saveBrandAction} className="mt-4 flex gap-2 rounded-xl border border-slate-200 bg-white p-4">
        <Input name="name" placeholder="Nueva marca" required className="w-64" aria-label="Nueva marca" />
        <Button type="submit" variant="secondary">
          Añadir
        </Button>
      </form>
    </>
  );
}
