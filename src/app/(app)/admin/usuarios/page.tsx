import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { departmentMembers, roles, userRoles, users } from "@/db/schema";
import { PageTitle, Table, Td, Th } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { createUserAction, updateUserAction } from "@/app/actions/admin";
import { getDepartments } from "@/lib/server/catalogs";
import { ROLE_LABEL } from "@/lib/labels";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Usuarios" };

export default async function UsersPage({ searchParams }: PageProps<"/admin/usuarios">) {
  const { estado } = await searchParams;
  const [list, roleRows, memberRows, depts] = await Promise.all([
    db
      .select()
      .from(users)
      .where(typeof estado === "string" && ["pending", "active", "disabled"].includes(estado) ? eq(users.status, estado as "pending") : undefined)
      .orderBy(sql`case ${users.status} when 'pending' then 0 when 'active' then 1 else 2 end`, asc(users.name)),
    db.select({ userId: userRoles.userId, key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)),
    db.select().from(departmentMembers),
    getDepartments(false),
  ]);
  return (
    <>
      <PageTitle
        title="Usuarios"
        description="Los usuarios se crean al iniciar sesión con Microsoft 365. Sin roles, quedan pendientes de activación y no ven proyectos."
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {[
          ["", "Todos"],
          ["pending", "Pendientes"],
          ["active", "Activos"],
          ["disabled", "Desactivados"],
        ].map(([v, l]) => (
          <a key={v} href={v ? `?estado=${v}` : "?"} className={`rounded-full px-3 py-1 ring-1 ${(estado ?? "") === v ? "bg-slate-900 text-white ring-slate-900" : "bg-white ring-slate-200"}`}>
            {l}
          </a>
        ))}
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Usuario</Th>
            <Th>Estado</Th>
            <Th>Roles</Th>
            <Th>Departamentos</Th>
            <Th>Notificaciones</Th>
            <Th>Último acceso</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {list.map((u) => {
            const rs = roleRows.filter((r) => r.userId === u.id).map((r) => r.key);
            const ds = memberRows.filter((m) => m.userId === u.id).map((m) => m.departmentId);
            const formId = `u-${u.id}`;
            return (
              <tr key={u.id} className={u.status === "pending" ? "bg-amber-50/60" : undefined}>
                <Td>
                  <form id={formId} action={updateUserAction}>
                    <input type="hidden" name="userId" value={u.id} />
                  </form>
                  <p className="font-medium">{u.name}</p>
                  <p className="text-xs text-slate-500">{u.email}</p>
                </Td>
                <Td>
                  <Select name="status" form={formId} defaultValue={u.status} className="h-8 w-auto text-xs">
                    <option value="pending">Pendiente</option>
                    <option value="active">Activo</option>
                    <option value="disabled">Desactivado</option>
                  </Select>
                </Td>
                <Td>
                  <div className="flex flex-col gap-0.5">
                    {Object.entries(ROLE_LABEL).map(([k, l]) => (
                      <label key={k} className="flex items-center gap-1.5 text-xs">
                        <input type="checkbox" name="roles" value={k} form={formId} defaultChecked={rs.includes(k as never)} className="accent-brand-600" /> {l}
                      </label>
                    ))}
                  </div>
                </Td>
                <Td>
                  <div className="grid max-h-32 grid-cols-1 gap-0.5 overflow-y-auto pr-2">
                    {depts.map((d) => (
                      <label key={d.id} className="flex items-center gap-1.5 whitespace-nowrap text-xs">
                        <input type="checkbox" name="departments" value={d.id} form={formId} defaultChecked={ds.includes(d.id)} className="accent-brand-600" /> {d.name}
                      </label>
                    ))}
                  </div>
                </Td>
                <Td>
                  <Select name="notifPref" form={formId} defaultValue={u.notifPref} className="h-8 w-auto text-xs">
                    <option value="immediate">Inmediato</option>
                    <option value="daily">Resumen diario</option>
                  </Select>
                </Td>
                <Td className="whitespace-nowrap text-xs text-slate-500">{formatDate(u.lastLoginAt, true)}</Td>
                <Td>
                  <Button size="sm" type="submit" form={formId}>
                    Guardar
                  </Button>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <form action={createUserAction} className="mt-6 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4">
        <p className="w-full text-sm font-medium">Pre-registrar usuario</p>
        <Input name="name" placeholder="Nombre" required className="w-56" />
        <Input name="email" type="email" placeholder="email@empresa.com" required className="w-64" />
        <Button type="submit" variant="secondary">
          Añadir
        </Button>
        <p className="w-full text-xs text-slate-500">Útil para asignar roles antes de su primer acceso. El SSO lo vinculará por email.</p>
      </form>
    </>
  );
}
