import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { departments, templateTaskDeps, templateTasks, workflowTemplates } from "@/db/schema";
import { PageTitle } from "@/components/admin";
import { DeptChip } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PHASES } from "@/lib/labels";

export const metadata = { title: "Plantillas de flujo" };

export default async function TemplatesPage() {
  const [tpls, tasks, deps] = await Promise.all([
    db.select().from(workflowTemplates).orderBy(asc(workflowTemplates.id)),
    db
      .select({ t: templateTasks, dept: departments.name, color: departments.color })
      .from(templateTasks)
      .innerJoin(departments, eq(departments.id, templateTasks.departmentId))
      .orderBy(asc(templateTasks.phase), asc(templateTasks.sort)),
    db.select().from(templateTaskDeps),
  ]);
  const title = (id: number | null) => tasks.find((x) => x.t.id === id)?.t.title;
  return (
    <>
      <PageTitle
        title="Plantillas de flujo"
        description="Plantillas iniciales (seed). En V1 se usan para sugerir los departamentos al aprobar P1; el editor de tareas llega con V2."
      />
      <div className="flex flex-col gap-4">
        {tpls.map((tpl) => (
          <Card key={tpl.id}>
            <details>
              <summary className="cursor-pointer px-4 py-3">
                <span className="font-medium">{tpl.name}</span>{" "}
                <span className="text-xs text-slate-500">
                  · aplica a {[tpl.appliesTo.types?.join("/"), tpl.appliesTo.subtypes?.join(", "), tpl.appliesTo.categories?.join(", ")].filter(Boolean).join(" · ")}
                </span>
              </summary>
              <div className="border-t border-slate-100 p-4">
                {PHASES.slice(1).map((ph) => {
                  const list = tasks.filter((x) => x.t.templateId === tpl.id && x.t.phase === ph.n);
                  if (!list.length) return null;
                  return (
                    <div key={ph.n} className="mb-4">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Fase {ph.n} · {ph.name}
                      </p>
                      <ul className="space-y-1 text-sm">
                        {list.map(({ t, dept, color }) => {
                          const before = deps.filter((d) => d.taskId === t.id).map((d) => title(d.dependsOnTaskId));
                          return (
                            <li key={t.id} className="flex flex-wrap items-center gap-2">
                              <DeptChip name={dept} color={color} />
                              <span>{t.title}</span>
                              {!t.isRequired && <span className="text-xs text-slate-400">(opcional)</span>}
                              <span className="text-xs text-slate-400">{t.estDays} d</span>
                              {before.length > 0 && <span className="text-xs text-slate-500">← depende de {before.join(", ")}</span>}
                              {t.canReturnToTaskId && <span className="text-xs text-amber-700">↺ puede devolver «{title(t.canReturnToTaskId)}»</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </details>
          </Card>
        ))}
      </div>
    </>
  );
}
