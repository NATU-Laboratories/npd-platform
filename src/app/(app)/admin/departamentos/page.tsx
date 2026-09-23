import { db } from "@/db";
import { departmentMembers } from "@/db/schema";
import { PageTitle } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { saveDepartmentAction } from "@/app/actions/admin";
import { getActiveUsers, getDepartments } from "@/lib/server/catalogs";

export const metadata = { title: "Departamentos" };

export default async function DepartmentsPage() {
  const [depts, people, members] = await Promise.all([getDepartments(false), getActiveUsers(), db.select().from(departmentMembers)]);
  const form = (d?: (typeof depts)[number]) => (
    <form action={saveDepartmentAction} className="grid gap-3 sm:grid-cols-2">
      {d && <input type="hidden" name="id" value={d.id} />}
      <input type="hidden" name="membersSubmitted" value="1" />
      <Field label="Nombre" required>
        <Input name="name" defaultValue={d?.name} required />
      </Field>
      <div className="flex gap-3">
        <Field label="Color">
          <input type="color" name="color" defaultValue={d?.color ?? "#64748b"} className="h-9 w-14 rounded border border-slate-300" />
        </Field>
        <Field label="Responsable" className="flex-1">
          <Select name="leadUserId" defaultValue={d?.leadUserId ?? ""}>
            <option value="">—</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Emails de notificación" hint="Separados por comas o saltos de línea" className="sm:col-span-2">
        <Textarea name="notifyEmails" rows={2} defaultValue={d?.notifyEmails.join(", ")} />
      </Field>
      <Field label="Miembros" className="sm:col-span-2">
        <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border border-slate-200 p-2 sm:grid-cols-3">
          {people.map((p) => (
            <Checkbox key={p.id} name="members" value={p.id} label={p.name} defaultChecked={!!d && members.some((m) => m.departmentId === d.id && m.userId === p.id)} />
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
      <PageTitle title="Departamentos" description="Nombre, color, emails que reciben las notificaciones, responsable y miembros." />
      <div className="flex flex-col gap-3">
        {depts.map((d) => (
          <Card key={d.id}>
            <details>
              <summary className="flex cursor-pointer items-center gap-3 px-4 py-3">
                <span className="size-3 rounded-full" style={{ background: d.color }} />
                <span className="font-medium">{d.name}</span>
                {!d.isActive && <span className="text-xs text-slate-400">(inactivo)</span>}
                <span className="ml-auto truncate text-xs text-slate-500">{d.notifyEmails.join(", ") || "sin emails"}</span>
                <span className="text-xs text-slate-400">{members.filter((m) => m.departmentId === d.id).length} miembros</span>
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
    </>
  );
}
