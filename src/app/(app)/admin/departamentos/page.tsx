import { db } from "@/db";
import { departmentMembers } from "@/db/schema";
import { PageTitle } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { saveDepartmentAction, saveSheetDepartmentsAction } from "@/app/actions/admin";
import { PHASES } from "@/lib/labels";
import { getActiveUsers, getDepartments } from "@/lib/server/catalogs";
import { sectionDeptKeys } from "@/lib/server/sheet";
import { SHEET_SECTIONS } from "@/lib/sheet/sections";

export const metadata = { title: "Departamentos" };

export default async function DepartmentsPage() {
  const [depts, people, members, sectionDept] = await Promise.all([getDepartments(false), getActiveUsers(), db.select().from(departmentMembers), sectionDeptKeys()]);
  const isMember = (d: { id: number }, userId: string) => members.some((m) => m.departmentId === d.id && m.userId === userId);
  const form = (d?: (typeof depts)[number]) => (
    <form action={saveDepartmentAction} className="grid gap-3 sm:grid-cols-2">
      {d && <input type="hidden" name="id" value={d.id} />}
      <input type="hidden" name="membersSubmitted" value="1" />
      <Field label="Nombre" required>
        <Input name="name" defaultValue={d?.name} required />
      </Field>
      <Field label="Color">
        <input type="color" name="color" defaultValue={d?.color ?? "#64748b"} className="h-9 w-14 rounded border border-slate-300" />
      </Field>
      <Field label="Emails de notificación" hint="Separados por comas o saltos de línea" className="sm:col-span-2">
        <Textarea name="notifyEmails" rows={2} defaultValue={d?.notifyEmails.join(", ")} />
      </Field>
      <Field label="Miembros" hint="Solo los miembros pueden rellenar el apartado del departamento en la ficha técnica y marcarlo como terminado (además del decisor global y los administradores)." className="sm:col-span-2">
        <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border border-slate-200 p-2 sm:grid-cols-3">
          {people.map((p) => (
            <Checkbox key={p.id} name="members" value={p.id} label={p.name} defaultChecked={!!d && isMember(d, p.id)} />
          ))}
        </div>
      </Field>
      <div className="flex items-center justify-between sm:col-span-2">
        <Checkbox name="isActive" label="Activo" defaultChecked={d?.isActive ?? true} />
        <Button type="submit" size="sm">
          {d ? "Guardar" : "Crear departamento"}
        </Button>
      </div>
    </form>
  );
  return (
    <>
      <PageTitle title="Departamentos" description="Nombre, color, emails que reciben las notificaciones y miembros." />
      <div className="flex flex-col gap-3">
        {depts.map((d) => (
          <Card key={d.id}>
            <details>
              <summary className="flex cursor-pointer items-center gap-3 px-4 py-3">
                <span className="size-3 rounded-full" style={{ background: d.color }} />
                <span className="font-medium">{d.name}</span>
                {!d.isActive && <span className="text-xs text-slate-400">(inactivo)</span>}
                <span className="ml-auto truncate text-xs text-slate-500">{d.notifyEmails.join(", ") || "sin emails"}</span>
                <span className="text-xs text-slate-400">
                  {members.filter((m) => m.departmentId === d.id).length} miembros
                </span>
              </summary>
              <div className="border-t border-slate-100 p-4">{form(d)}</div>
            </details>
          </Card>
        ))}
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium">Nuevo departamento</p>
          {form()}
        </Card>
      </div>

      <Card className="mt-8 p-4">
        <h2 className="text-base font-semibold text-slate-900">Apartados de la ficha técnica</h2>
        <p className="mb-4 text-sm text-slate-500">Qué departamento completa cada apartado. Sus miembros serán quienes puedan editarlo y marcarlo como terminado.</p>
        <form action={saveSheetDepartmentsAction} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {SHEET_SECTIONS.map((s) => (
              <Field key={s.key} label={s.title} hint={`Fase ${s.phase} · ${PHASES[s.phase]?.name}`}>
                <Select name={`sheet_${s.key}`} defaultValue={sectionDept[s.key]}>
                  {depts
                    .filter((d) => d.isActive && d.key)
                    .map((d) => (
                      <option key={d.id} value={d.key!}>
                        {d.name}
                      </option>
                    ))}
                </Select>
              </Field>
            ))}
          </div>
          <Button type="submit" size="sm" className="self-end">
            Guardar asignación
          </Button>
        </form>
      </Card>
    </>
  );
}
