import { db } from "@/db";
import { projectDeptProgress } from "@/db/schema";
import { PageTitle } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { addSubstateAction, deleteSubstateAction, saveSubstateAction } from "@/app/actions/admin";
import { getDepartments } from "@/lib/server/catalogs";
import { allSubstates, sectionDeptKeys } from "@/lib/server/sheet";
import { scalarFields, SHEET_SECTIONS } from "@/lib/sheet/sections";

export const metadata = { title: "Estados de departamento" };

function Checks({ name, options, selected }: { name: string; options: { value: string; label: string }[]; selected: string[] }) {
  if (!options.length) return <p className="text-xs text-slate-400">—</p>;
  return (
    <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border border-slate-200 p-2 sm:grid-cols-2">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-2 text-xs">
          <input type="checkbox" name={name} value={o.value} defaultChecked={selected.includes(o.value)} className="size-3.5 accent-brand-600" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export default async function SubstatesPage() {
  const [depts, substates, deptOf, inUse] = await Promise.all([
    getDepartments(),
    allSubstates(),
    sectionDeptKeys(),
    db.selectDistinct({ id: projectDeptProgress.substateId }).from(projectDeptProgress),
  ]);
  const used = new Set(inUse.map((x) => x.id));
  // Departamentos con apartados en la ficha primero, en el orden de las fases
  const firstPhase = (key: string) => Math.min(99, ...SHEET_SECTIONS.filter((s) => deptOf[s.key] === key).map((s) => s.phase));
  const list = depts.filter((d) => d.key).sort((a, b) => firstPhase(a.key!) - firstPhase(b.key!));

  return (
    <>
      <PageTitle
        title="Estados de departamento"
        description="Lista ordenada de estados de cada departamento en un proyecto. Alcanzar un estado final completa la parte del departamento. Los campos marcados como obligatorios para un estado impiden entrar en él si no están rellenos."
      />
      <div className="flex flex-col gap-4">
        {list.map((d) => {
          const steps = substates.filter((s) => s.departmentId === d.id);
          const fieldOptions = SHEET_SECTIONS.filter((s) => deptOf[s.key] === d.key).flatMap((sec) =>
            scalarFields(sec).map((f) => ({ value: `${sec.key}.${f.key}`, label: `${sec.title} · ${f.label}` })),
          );
          return (
            <Card key={d.id}>
              <details open={steps.length > 0 && firstPhase(d.key!) < 99}>
                <summary className="flex cursor-pointer items-center gap-3 px-4 py-3">
                  <span className="size-3 rounded-full" style={{ background: d.color }} />
                  <span className="font-medium">{d.name}</span>
                  <span className="ml-auto truncate text-xs text-slate-500">{steps.length ? steps.map((s) => s.name + (s.isFinal ? " ✓" : "")).join(" → ") : "sin estados"}</span>
                </summary>
                <div className="flex flex-col gap-3 border-t border-slate-100 p-4">
                  {firstPhase(d.key!) === 99 && <p className="text-xs text-amber-700">Este departamento no tiene apartados en la ficha técnica: sus estados no se mostrarán en los proyectos.</p>}
                  {steps.map((s, i) => (
                    <details key={s.id} className="rounded-lg border border-slate-200">
                      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                        <span className="flex size-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">{i + 1}</span>
                        <span className="font-medium">{s.name}</span>
                        {s.isFinal && <span className="rounded-full bg-[#eef0e6] px-2 py-0.5 text-[11px] text-[#56613f]">final</span>}
                        {s.requiredFields.length > 0 && <span className="text-[11px] text-slate-500">· {s.requiredFields.length} obligatorio(s)</span>}
                        {s.promptFields.length > 0 && <span className="text-[11px] text-slate-500">· pide {s.promptFields.length} campo(s)</span>}
                      </summary>
                      <form action={saveSubstateAction} className="grid gap-3 border-t border-slate-100 p-3 sm:grid-cols-2">
                        <input type="hidden" name="id" value={s.id} />
                        <label className="flex flex-col gap-1 text-xs text-slate-600">
                          Nombre
                          <Input name="name" defaultValue={s.name} required className="h-8 text-sm" />
                        </label>
                        <div className="flex items-end gap-4">
                          <label className="flex flex-col gap-1 text-xs text-slate-600">
                            Orden
                            <Input name="sort" type="number" defaultValue={s.sort} className="h-8 w-24 text-sm" />
                          </label>
                          <label className="flex items-center gap-2 pb-2 text-sm">
                            <input type="checkbox" name="isFinal" defaultChecked={s.isFinal} className="size-4 accent-brand-600" /> Estado final
                          </label>
                        </div>
                        <div className="flex flex-col gap-1 text-xs text-slate-600">
                          Puede volver a
                          <Checks name="canReturnTo" options={steps.filter((x) => x.id !== s.id).map((x) => ({ value: String(x.id), label: x.name }))} selected={s.canReturnTo.map(String)} />
                        </div>
                        <div className="flex flex-col gap-1 text-xs text-slate-600">
                          Obligatorios para entrar en este estado
                          <Checks name="requiredFields" options={fieldOptions} selected={s.requiredFields} />
                        </div>
                        <div className="flex flex-col gap-1 text-xs text-slate-600 sm:col-span-2">
                          Se piden (opcionales) al pasar a este estado
                          <Checks name="promptFields" options={fieldOptions} selected={s.promptFields} />
                        </div>
                        <div className="flex justify-end sm:col-span-2">
                          <Button type="submit" size="sm">
                            Guardar
                          </Button>
                        </div>
                      </form>
                      <form action={deleteSubstateAction} className="flex justify-end border-t border-slate-100 px-3 py-2">
                        <input type="hidden" name="id" value={s.id} />
                        {used.has(s.id) ? (
                          <span className="text-xs text-slate-400">No se puede eliminar: hay proyectos en este estado.</span>
                        ) : (
                          <Button type="submit" size="sm" variant="ghost" className="text-rose-700">
                            Eliminar estado
                          </Button>
                        )}
                      </form>
                    </details>
                  ))}
                  <form action={addSubstateAction} className="flex gap-2">
                    <input type="hidden" name="departmentId" value={d.id} />
                    <Input name="name" placeholder="Nuevo estado" required className="h-8 w-64 text-sm" aria-label={`Nuevo estado de ${d.name}`} />
                    <Button type="submit" size="sm" variant="secondary">
                      Añadir
                    </Button>
                  </form>
                </div>
              </details>
            </Card>
          );
        })}
      </div>
    </>
  );
}
