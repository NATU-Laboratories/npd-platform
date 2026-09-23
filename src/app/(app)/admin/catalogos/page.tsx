import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { catalogItems, clients, users } from "@/db/schema";
import { PageTitle, Table, Td, Th } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form";
import { addCatalogItemAction, importClientsAction, saveBrandAction, saveClientAction, updateCatalogItemAction } from "@/app/actions/admin";
import { CATALOG_TYPES } from "@/lib/catalog-defaults";
import { getActiveUsers, getBrands } from "@/lib/server/catalogs";

export const metadata = { title: "Catálogos" };

export default async function CatalogsPage({ searchParams }: PageProps<"/admin/catalogos">) {
  const { tipo } = await searchParams;
  const current = typeof tipo === "string" ? tipo : "brands";
  const tabs: [string, string][] = [["brands", "Marcas"], ["clients", "Clientes"], ...Object.entries(CATALOG_TYPES)];

  return (
    <>
      <PageTitle title="Catálogos" description="Valores de los desplegables del asistente y del backoffice." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {tabs.map(([k, l]) => (
          <Link key={k} href={`?tipo=${k}`} className={`rounded-full px-3 py-1 text-xs ring-1 ${current === k ? "bg-slate-900 text-white ring-slate-900" : "bg-white ring-slate-200"}`}>
            {l}
          </Link>
        ))}
      </div>
      {current === "brands" ? <Brands /> : current === "clients" ? <Clients /> : <Items type={current} />}
    </>
  );
}

async function Items({ type }: { type: string }) {
  const rows = await db.select().from(catalogItems).where(eq(catalogItems.type, type)).orderBy(asc(catalogItems.sort), asc(catalogItems.label));
  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>Valor (clave)</Th>
            <Th>Etiqueta</Th>
            <Th>Orden</Th>
            <Th>Activo</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.isActive ? undefined : "opacity-50"}>
              <Td className="font-mono text-xs">
                <form id={`c${r.id}`} action={updateCatalogItemAction}>
                  <input type="hidden" name="id" value={r.id} />
                </form>
                {r.value}
              </Td>
              <Td>
                <Input name="label" form={`c${r.id}`} defaultValue={r.label} className="h-8 text-xs" />
              </Td>
              <Td>
                <Input name="sort" type="number" form={`c${r.id}`} defaultValue={r.sort} className="h-8 w-20 text-xs" />
              </Td>
              <Td>
                <input type="checkbox" name="isActive" form={`c${r.id}`} defaultChecked={r.isActive} className="accent-brand-600" />
              </Td>
              <Td>
                <Button size="sm" variant="secondary" type="submit" form={`c${r.id}`}>
                  Guardar
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <form action={addCatalogItemAction} className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4">
        <input type="hidden" name="type" value={type} />
        <Input name="label" placeholder="Etiqueta" required className="w-64" />
        <Input name="value" placeholder="Clave (opcional)" className="w-48" />
        <Button type="submit" variant="secondary">
          Añadir
        </Button>
        <p className="w-full text-xs text-slate-500">Para desactivar un valor en uso, desmarca «Activo»: los proyectos existentes lo conservan.</p>
      </form>
    </>
  );
}

async function Brands() {
  const rows = await getBrands(false);
  return (
    <>
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
                <Input name="name" form={`b${b.id}`} defaultValue={b.name} className="h-8 text-sm" />
              </Td>
              <Td>
                <input type="checkbox" name="isActive" form={`b${b.id}`} defaultChecked={b.isActive} className="accent-brand-600" />
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
        <Input name="name" placeholder="Nueva marca" required className="w-64" />
        <Button type="submit" variant="secondary">
          Añadir
        </Button>
      </form>
    </>
  );
}

async function Clients() {
  const [rows, people] = await Promise.all([
    db.select({ c: clients, am: users.name }).from(clients).leftJoin(users, eq(users.id, clients.accountManagerUserId)).orderBy(asc(clients.name)).limit(1000),
    getActiveUsers(),
  ]);
  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>Cliente</Th>
            <Th>País</Th>
            <Th>Contacto</Th>
            <Th>Ref. externa</Th>
            <Th>Comercial</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ c }) => (
            <tr key={c.id}>
              <Td>
                <form id={`cl${c.id}`} action={saveClientAction}>
                  <input type="hidden" name="id" value={c.id} />
                </form>
                <Input name="name" form={`cl${c.id}`} defaultValue={c.name} className="h-8 text-xs" />
              </Td>
              <Td>
                <Input name="country" form={`cl${c.id}`} defaultValue={c.country ?? ""} className="h-8 w-16 text-xs" />
              </Td>
              <Td>
                <Input name="contact" form={`cl${c.id}`} defaultValue={c.contact ?? ""} className="h-8 text-xs" />
              </Td>
              <Td>
                <Input name="externalRef" form={`cl${c.id}`} defaultValue={c.externalRef ?? ""} className="h-8 w-28 text-xs" />
              </Td>
              <Td>
                <Select name="accountManagerUserId" form={`cl${c.id}`} defaultValue={c.accountManagerUserId ?? ""} className="h-8 text-xs">
                  <option value="">—</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Td>
              <Td>
                <Button size="sm" variant="secondary" type="submit" form={`cl${c.id}`}>
                  Guardar
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <form action={saveClientAction} className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-4">
          <p className="w-full text-sm font-medium">Nuevo cliente</p>
          <Input name="name" placeholder="Nombre" required className="w-56" />
          <Input name="country" placeholder="País (ES)" className="w-24" />
          <Input name="contact" placeholder="Contacto" className="w-56" />
          <Button type="submit" variant="secondary">
            Añadir
          </Button>
        </form>
        <form action={importClientsAction} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-medium">Carga inicial (CSV)</p>
          <Textarea name="csv" rows={4} placeholder={"nombre;país;contacto;ref_externa\nSupermercados X;ES;compras@x.com;PD-123"} className="font-mono text-xs" />
          <Button type="submit" variant="secondary" className="self-end">
            Importar
          </Button>
        </form>
      </div>
    </>
  );
}
