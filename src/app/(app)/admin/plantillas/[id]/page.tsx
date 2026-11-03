import { asc, eq, inArray } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { templateTaskDeps, templateTasks, workflowTemplates } from "@/db/schema";
import { PageTitle } from "@/components/admin";
import { TemplateEditor, type EditorTemplate } from "@/components/admin-templates/template-editor";
import { getCatalog, getDepartments } from "@/lib/server/catalogs";

export const metadata = { title: "Editar plantilla de flujo" };

export default async function TemplateEditPage({ params }: PageProps<"/admin/plantillas/[id]">) {
  const { id } = await params;
  const isNew = id === "nueva";
  if (!isNew && !/^\d+$/.test(id)) notFound();
  const [depts, subtypes] = await Promise.all([getDepartments(false), getCatalog("pl_subtype")]);

  let initial: EditorTemplate = { id: null, name: "", isActive: true, appliesTo: { types: [], subtypes: [], categories: [] }, tasks: [] };
  if (!isNew) {
    const [tpl] = await db.select().from(workflowTemplates).where(eq(workflowTemplates.id, Number(id)));
    if (!tpl) notFound();
    const list = await db.select().from(templateTasks).where(eq(templateTasks.templateId, tpl.id)).orderBy(asc(templateTasks.phase), asc(templateTasks.sort));
    const deps = list.length ? await db.select().from(templateTaskDeps).where(inArray(templateTaskDeps.taskId, list.map((x) => x.id))) : [];
    initial = {
      id: tpl.id,
      name: tpl.name,
      isActive: tpl.isActive,
      appliesTo: { types: (tpl.appliesTo.types ?? []) as ("PL" | "MP" | "MDD")[], subtypes: tpl.appliesTo.subtypes ?? [], categories: tpl.appliesTo.categories ?? [] },
      tasks: list.map((x) => ({
        key: String(x.id),
        phase: x.phase,
        departmentId: x.departmentId,
        title: x.title,
        description: x.description ?? "",
        isRequired: x.isRequired,
        estDays: x.estDays,
        deps: deps.filter((d) => d.taskId === x.id).map((d) => String(d.dependsOnTaskId)),
        returnsTo: x.canReturnToTaskId ? String(x.canReturnToTaskId) : null,
      })),
    };
  }

  return (
    <>
      <Link href="/admin/plantillas" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Plantillas de flujo
      </Link>
      <PageTitle
        title={isNew ? "Nueva plantilla de flujo" : initial.name}
        description="Define a qué proyectos aplica y las tareas de cada fase. Los departamentos de las tareas son los que se proponen al aprobar P1."
      />
      <TemplateEditor
        initial={initial}
        departments={depts.map((d) => ({ id: d.id, name: d.name, color: d.color, isActive: d.isActive }))}
        subtypes={subtypes}
      />
    </>
  );
}
