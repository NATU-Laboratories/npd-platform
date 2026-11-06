import * as React from "react";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, departmentMembers, roles, userRoles, users } from "@/db/schema";
import { PageTitle, Table, Td, Th } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { createUserAction, updateUserAction, viewAsAction } from "@/app/actions/admin";
import { Eye } from "lucide-react";
import { DeleteUserButton } from "@/components/delete-user-button";
import { getDepartments } from "@/lib/server/catalogs";
import { requireAdmin } from "@/lib/server/authz";
import { EDITABLE_ROLES, ROLE_HELP, ROLE_LABEL, TEST_EMAIL_DOMAIN } from "@/lib/labels";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Usuarios" };

export default async function UsersPage({ searchParams }: PageProps<"/admin/usuarios">) {
  const { estado, autorizar, nombre } = await searchParams;
  const me = await requireAdmin();
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
  // Cuentas corporativas que han intentado entrar sin estar autorizadas (últimos 30 días)
  const attempts = await db
    .select({ email: activityLog.entityId, diff: activityLog.diff, at: activityLog.createdAt })
    .from(activityLog)
    .where(and(eq(activityLog.action, "auth.denied"), gte(activityLog.createdAt, sql`now() - interval '30 days'`)))
    .orderBy(desc(activityLog.createdAt))
    .limit(200);
  const known = new Set(list.map((u) => u.email.toLowerCase()));
  const denied = [...new Map(attempts.filter((a) => a.email && !known.has(a.email) && (a.diff as { reason?: string })?.reason === "notAuthorized").map((a) => [a.email!, a])).values()].slice(0, 20);
  const prefillEmail = typeof autorizar === "string" ? autorizar : "";
  const prefillName = typeof nombre === "string" ? nombre : "";
  return (
    <>
      <PageTitle
        title="Usuarios"
        description="Solo pueden entrar con su cuenta corporativa de Microsoft 365 las personas autorizadas aquí, con su email, rol y departamentos. Para quitar el acceso, pon el estado en «Desactivado»."
      />
      <details className="mb-4 rounded-lg border border-slate-200 bg-white text-sm">
        <summary className="cursor-pointer px-4 py-2.5 font-medium text-slate-700">¿Qué da cada rol y cada departamento?</summary>
        <dl className="grid gap-x-6 gap-y-2 border-t border-slate-100 px-4 py-3 sm:grid-cols-[auto_1fr]">
          {EDITABLE_ROLES.map((k) => (
            <React.Fragment key={k}>
              <dt className="font-medium text-slate-900">{ROLE_LABEL[k]}</dt>
              <dd className="text-slate-600">{ROLE_HELP[k]}</dd>
            </React.Fragment>
          ))}
          <dt className="font-medium text-slate-900">Departamentos</dt>
          <dd className="text-slate-600">
            Ve los proyectos en los que participa su departamento, edita su parte de la ficha, avanza sus estados y recibe sus avisos. Marketing / NPD además ve
            todos los proyectos y coordina (edita briefs y avanza fases).
          </dd>
          <dt className="font-medium text-slate-900">Aprobadores</dt>
          <dd className="text-slate-600">No es una casilla: se asignan en Backoffice → Aprobadores (quién aprueba P1/P2 de cada tipo de proyecto).</dd>
        </dl>
      </details>
      {denied.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-amber-900">Han intentado entrar sin estar autorizados</p>
          <p className="mb-2 text-xs text-amber-800">Cuentas corporativas de los últimos 30 días. Si deben tener acceso, autorízalas con su rol y departamentos.</p>
          <ul className="flex flex-col gap-1">
            {denied.map((a) => {
              const n = String((a.diff as { name?: string })?.name ?? "");
              return (
                <li key={a.email} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{n || a.email}</span>
                  {n && <span className="text-slate-600">{a.email}</span>}
                  <span className="text-xs text-slate-500">· {formatDate(a.at, true)}</span>
                  <a href={`?autorizar=${encodeURIComponent(a.email!)}&nombre=${encodeURIComponent(n)}#autorizar`} className="text-xs font-medium text-brand-600 underline underline-offset-2 hover:text-brand-800">
                    Autorizar
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
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
                  <div className="flex items-center gap-1">
                    <p className="font-medium">{u.name}</p>
                    {u.id !== me.id && (
                      <form action={viewAsAction}>
                        <input type="hidden" name="userId" value={u.id} />
                        <button
                          type="submit"
                          title={`Ver la plataforma como ${u.name} (solo lectura)`}
                          aria-label={`Ver como ${u.name}`}
                          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        >
                          <Eye className="size-4" />
                        </button>
                      </form>
                    )}
                    {u.id !== me.id && <DeleteUserButton userId={u.id} name={u.name} />}
                  </div>
                  <Input
                    name="email"
                    type="email"
                    form={formId}
                    defaultValue={u.email.endsWith(`@${TEST_EMAIL_DOMAIN}`) ? "" : u.email}
                    placeholder={u.email.endsWith(`@${TEST_EMAIL_DOMAIN}`) ? "Sin email (pruebas): añade uno" : "email@empresa.com"}
                    aria-label={`Email de ${u.name}`}
                    className="mt-1 h-7 w-48 text-xs"
                  />
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
                    {EDITABLE_ROLES.map((k) => (
                      <label key={k} className="flex items-center gap-1.5 text-xs" title={ROLE_HELP[k]}>
                        <input type="checkbox" name="roles" value={k} form={formId} defaultChecked={rs.includes(k as never)} className="accent-brand-600" /> {ROLE_LABEL[k]}
                      </label>
                    ))}
                  </div>
                </Td>
                <Td>
                  <div className="grid max-h-36 min-w-48 grid-cols-1 gap-0.5 overflow-y-auto pr-2">
                    {depts.map((d) => (
                      <label key={d.id} className="flex items-start gap-1.5 text-xs leading-snug">
                        <input type="checkbox" name="departments" value={d.id} form={formId} defaultChecked={ds.includes(d.id)} className="mt-0.5 accent-brand-600" /> {d.name}
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
                  <Button size="sm" variant="secondary" type="submit" form={formId}>
                    Guardar
                  </Button>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <form id="autorizar" action={createUserAction} className="mt-6 flex scroll-mt-24 flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <p className="text-sm font-semibold text-slate-900">Autorizar usuario</p>
          <p className="text-xs text-slate-500">
            Con su email corporativo podrá entrar con «Entrar con Microsoft». Con rol o departamento queda activo al momento; sin ninguno, queda pendiente.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input name="name" placeholder="Nombre y apellidos…" required className="w-64" defaultValue={prefillName} aria-label="Nombre y apellidos" autoComplete="off" />
          <Input
            name="email"
            type="email"
            placeholder="nombre@natuaromatic.com…"
            className="w-72"
            defaultValue={prefillEmail}
            aria-label="Email corporativo"
            autoComplete="off"
            spellCheck={false}
          />
          <Select name="notifPref" defaultValue="immediate" className="w-auto" aria-label="Notificaciones">
            <option value="immediate">Avisos inmediatos</option>
            <option value="daily">Resumen diario</option>
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Roles</legend>
            <div className="flex flex-col gap-1">
              {EDITABLE_ROLES.map((k) => (
                <label key={k} className="flex items-center gap-1.5 text-sm" title={ROLE_HELP[k]}>
                  <input type="checkbox" name="roles" value={k} className="accent-brand-600" /> {ROLE_LABEL[k]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Departamentos</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {depts.map((d) => (
                <label key={d.id} className="flex items-start gap-1.5 text-sm leading-snug">
                  <input type="checkbox" name="departments" value={d.id} className="mt-0.5 accent-brand-600" /> {d.name}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500">Sin email queda como usuario de pruebas: no recibe correos ni puede entrar (útil con «Ver como»).</p>
          <Button type="submit">Autorizar</Button>
        </div>
      </form>
    </>
  );
}
