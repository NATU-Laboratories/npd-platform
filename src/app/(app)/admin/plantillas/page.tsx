import { asc, count, eq } from "drizzle-orm";
import { Plus } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { departments, projects, templateTasks, workflowTemplates } from "@/db/schema";
import { PageTitle } from "@/components/admin";
import { TemplateRowActions } from "@/components/admin-templates/row-actions";
import { DeptChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCatalog } from "@/lib/server/catalogs";
import { appliesToSummary } from "@/components/admin-templates/applies";

export const metadata = { title: "Plantillas de flujo" };

export default async function TemplatesPage() {
  const [tpls, taskRows, usage, subtypes] = await Promise.all([
    db.select().from(workflowTemplates).orderBy(asc(workflowTemplates.name)),
    db
      .selectDistinct({ templateId: templateTasks.templateId, dept: departments.name, color: departments.color, sort: departments.sort })
      .from(templateTasks)
      .innerJoin(departments, eq(departments.id, templateTasks.departmentId))
      .orderBy(asc(departments.sort)),
    db.select({ templateId: projects.templateId, n: count() }).from(projects).groupBy(projects.templateId),
    getCatalog("pl_subtype"),
  ]);
  const taskCount = await db.select({ templateId: templateTasks.templateId, n: count() }).from(templateTasks).groupBy(templateTasks.templateId);
  return (
    <>
      <PageTitle
        title="Plantillas de flujo"
        description="Al aprobar P1 se propone la plantilla que mejor encaja con el proyecto (tipo, subtipo y categoría) y, con ella, los departamentos implicados. Quien aprueba puede cambiarlos."
        actions={
          <Button asChild>
            <Link href="/admin/plantillas/nueva">
              <Plus /> Nueva plantilla
            </Link>
          </Button>
        }
      />
      {!tpls.length && <p className="text-sm text-slate-500">Todavía no hay plantillas.</p>}
      <div className="flex flex-col gap-3">
        {tpls.map((tpl) => {
          const depts = taskRows.filter((r) => r.templateId === tpl.id);
          const used = usage.find((u) => u.templateId === tpl.id)?.n ?? 0;
          const n = taskCount.find((t) => t.templateId === tpl.id)?.n ?? 0;
          return (
            <Card key={tpl.id} className={tpl.isActive ? "" : "opacity-70"}>
              <div className="flex flex-wrap items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/plantillas/${tpl.id}`} className="font-medium text-slate-900 hover:underline">
                      {tpl.name}
                    </Link>
                    {!tpl.isActive && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">Inactiva</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {appliesToSummary(tpl.appliesTo, subtypes)} · {n} {n === 1 ? "tarea" : "tareas"}
                    {used > 0 && ` · usada en ${used} ${used === 1 ? "proyecto" : "proyectos"}`}
                  </p>
                  {depts.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {depts.map((d) => (
                        <DeptChip key={d.dept} name={d.dept} color={d.color} />
                      ))}
                    </div>
                  )}
                </div>
                <TemplateRowActions id={tpl.id} name={tpl.name} isActive={tpl.isActive} usedIn={used} />
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
