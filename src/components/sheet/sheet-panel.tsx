import { CheckCircle2, ChevronDown, Circle, FileText, Info } from "lucide-react";
import { OlfactoryPyramid } from "@/components/project/olfactory-pyramid";
import type { UploadedFile } from "@/components/uploader";
import { Card, CardHeader } from "@/components/ui/card";
import { PHASES } from "@/lib/labels";
import type { SheetEntry } from "@/lib/server/sheet";
import { applicable, formatValue, type SheetCtx, type SheetData, type SheetField } from "@/lib/sheet/sections";
import { cn, formatBytes, formatDate } from "@/lib/utils";
import { SectionEditor } from "./section-editor";
import { SectionStatusActions } from "./section-status";

const SAGE = "bg-[#eef0e6] text-[#56613f] ring-natu-sage";

function statusPill(e: SheetEntry) {
  if (e.status === "done") return { label: "Terminado", cls: SAGE };
  if (e.status === "na") return { label: "No aplica", cls: "bg-slate-100 text-slate-600 ring-slate-300" };
  if (!e.due) return { label: "Próximas fases", cls: "bg-white text-slate-500 ring-slate-200" };
  if (e.complete) return { label: "Listo para cerrar", cls: "bg-[#f9ede6] text-[#7a4f3b] ring-natu-peach" };
  return { label: `Pendiente · faltan ${e.total - e.done}`, cls: "bg-brand-50 text-brand-500 ring-brand-200" };
}

function Pill({ e }: { e: SheetEntry }) {
  const s = statusPill(e);
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1", s.cls)}>{s.label}</span>;
}

function Bar({ e }: { e: SheetEntry }) {
  const pct = e.status === "na" ? 0 : e.total ? Math.round((e.done / e.total) * 100) : 100;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <span className={cn("block h-full rounded-full", e.status === "done" ? "bg-[#7f8f63]" : "bg-brand-400")} style={{ width: `${e.status === "done" ? 100 : pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-slate-500">{e.status === "na" ? "—" : `${e.done}/${e.total}`}</span>
    </div>
  );
}

function FileList({ list }: { list: UploadedFile[] }) {
  if (!list.length) return <span className="text-slate-300">—</span>;
  return (
    <ul className="flex flex-col gap-1">
      {list.map((f) => (
        <li key={f.id} className="flex items-center gap-2 text-sm">
          <FileText className="size-4 shrink-0 text-slate-400" />
          <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:underline">
            {f.name}
          </a>
          <span className="shrink-0 text-xs text-slate-400">{formatBytes(f.size)}</span>
        </li>
      ))}
    </ul>
  );
}

function FieldView({ f, data, ctx, files }: { f: SheetField; data: SheetData; ctx: SheetCtx; files: UploadedFile[] }) {
  if (f.type === "files") {
    return (
      <div className="sm:col-span-2">
        <dt className="text-xs text-slate-500">{f.label}</dt>
        <dd className="mt-1">
          <FileList list={files.filter((x) => x.tag === f.tag)} />
        </dd>
      </div>
    );
  }
  if (f.type === "list") {
    const items = (Array.isArray(data[f.key]) ? data[f.key] : []) as SheetData[];
    const sub = applicable(f.item, ctx);
    return (
      <div className="sm:col-span-2">
        <dt className="mb-2 text-xs text-slate-500">{f.label}</dt>
        <dd>
          {!items.length && <span className="text-slate-300">—</span>}
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((it, i) => (
              <div key={i} className={cn("rounded-lg border p-3", it.approved ? "border-natu-sage bg-[#f6f7f1]" : "border-slate-200 bg-white")}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-slate-900">
                    {String(it.name ?? `${f.itemLabel} ${i + 1}`)}
                    {typeof it.code === "string" && <span className="ml-2 font-mono text-xs font-normal text-slate-500">{it.code}</span>}
                  </p>
                  {it.approved === true ? (
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", SAGE)}>
                      Aprobada{typeof it.approvedAt === "string" ? ` · ${formatValue({ key: "d", label: "", type: "date" }, it.approvedAt)}` : ""}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">Sin aprobar</span>
                  )}
                </div>
                {ctx.olfactory && (
                  <div className="mt-2">
                    <OlfactoryPyramid top={it.top as string[] | undefined} heart={it.heart as string[] | undefined} base={it.base as string[] | undefined} />
                  </div>
                )}
                {sub
                  .filter((x) => !["name", "code", "approved", "approvedAt", "top", "heart", "base"].includes(x.key))
                  .map((x) => {
                    const v = formatValue(x, it[x.key]);
                    return v ? (
                      <p key={x.key} className="mt-2 whitespace-pre-line text-xs text-slate-600">
                        <span className="text-slate-400">{x.label}: </span>
                        {v}
                      </p>
                    ) : null;
                  })}
              </div>
            ))}
          </div>
        </dd>
      </div>
    );
  }
  const v = formatValue(f, data[f.key]);
  return (
    <div className={cn("min-w-0", (f.type === "textarea" || f.type === "multi") && "sm:col-span-2")}>
      <dt className="text-xs text-slate-500">{f.label}</dt>
      <dd className={cn("whitespace-pre-line break-words text-sm", v ? "text-slate-900" : "text-slate-300")}>{v ?? "—"}</dd>
    </div>
  );
}

export function SheetPanel({
  projectId,
  entries,
  ctx,
  files,
  editable,
  maxMb,
  noteSuggestions,
}: {
  projectId: string;
  entries: SheetEntry[];
  ctx: SheetCtx;
  files: UploadedFile[];
  editable: Record<string, boolean>;
  maxMb: number;
  noteSuggestions: string[];
}) {
  const closed = entries.filter((e) => e.status !== "pending").length;
  const dueOpen = entries.filter((e) => e.due && e.status === "pending");
  return (
    <Card id="ficha">
      <CardHeader
        title="Ficha técnica"
        description="Lo que aporta cada departamento conforme avanza el proyecto. Cada responsable completa su apartado y lo marca como terminado."
        actions={
          <span className="text-xs text-slate-500">
            <b className="text-base font-bold text-slate-900 tabular-nums">{closed}</b> de {entries.length} terminados
          </span>
        }
      />

      {/* Resumen: qué está hecho y qué falta, por departamento */}
      <div className="overflow-x-auto border-b border-slate-100">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-5 py-2 font-medium">Apartado</th>
              <th className="px-3 py-2 font-medium">Departamento</th>
              <th className="px-3 py-2 font-medium">Progreso</th>
              <th className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((e) => (
              <tr key={e.section.key} className={cn(!e.due && e.status === "pending" && "text-slate-500")}>
                <td className="px-5 py-2.5">
                  <a href={`#ficha-${e.section.key}`} className="font-medium text-slate-900 hover:underline">
                    {e.title}
                  </a>
                  <p className="text-xs text-slate-500">
                    Fase {e.section.phase} · {PHASES[e.section.phase]?.name}
                  </p>
                </td>
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    <span className="size-2 rounded-full" style={{ background: e.dept.color }} aria-hidden />
                    {e.dept.name}
                  </span>
                  <p className="text-xs text-slate-500">{e.dept.leads.length ? `Resp.: ${e.dept.leads.join(", ")}` : "Sin responsable asignado"}</p>
                </td>
                <td className="px-3 py-2.5">
                  <Bar e={e} />
                </td>
                <td className="px-3 py-2.5">
                  <Pill e={e} />
                  {e.status !== "pending" && e.statusAt && (
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {e.statusBy} · {formatDate(e.statusAt)}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dueOpen.length > 0 && (
        <p className="flex items-start gap-2 border-b border-slate-100 bg-brand-50/60 px-5 py-2.5 text-xs text-slate-700">
          <Info className="mt-0.5 size-3.5 shrink-0 text-brand-500" />
          <span>
            Pendiente hasta la fase actual: {dueOpen.map((e) => `${e.title} (${e.dept.name})`).join(" · ")}
          </span>
        </p>
      )}

      {/* Apartados */}
      <div className="divide-y divide-slate-100">
        {entries.map((e) => {
          const canEdit = editable[e.section.key] ?? false;
          const missing = e.reqs.filter((r) => !r.ok);
          return (
            <details key={e.section.key} id={`ficha-${e.section.key}`} open={e.due || e.status !== "pending"} className="group scroll-mt-24">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 hover:bg-slate-50">
                <ChevronDown className="size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: e.dept.color }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-slate-900">{e.title}</span>
                  <span className="ml-2 text-xs text-slate-500">{e.dept.name}</span>
                </span>
                <Pill e={e} />
              </summary>
              <div className="flex flex-col gap-4 px-5 pb-5 pt-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="max-w-prose text-sm text-slate-600">{e.section.description}</p>
                  {canEdit && (
                    <div className="flex flex-wrap items-center gap-2">
                      <SectionEditor
                        projectId={projectId}
                        sectionKey={e.section.key}
                        title={e.title}
                        ctx={ctx}
                        initial={e.data}
                        files={files}
                        maxMb={maxMb}
                        noteSuggestions={noteSuggestions}
                      />
                      <SectionStatusActions projectId={projectId} sectionKey={e.section.key} title={e.title} status={e.status} missing={missing.length} />
                    </div>
                  )}
                </div>

                {e.status === "na" && (
                  <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
                    No aplica · {e.statusBy} el {formatDate(e.statusAt)}
                    {e.statusNote ? ` — ${e.statusNote}` : ""}
                  </p>
                )}

                {e.status !== "na" && e.reqs.length > 0 && (
                  <ul className="grid gap-1.5 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-2" aria-label="Requisitos del apartado">
                    {e.reqs.map((r) => (
                      <li key={r.label} className={cn("flex items-start gap-2 text-sm", r.ok ? "text-slate-700" : "text-slate-900")}>
                        {r.ok ? (
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#7f8f63]" aria-label="Hecho" />
                        ) : (
                          <Circle className="mt-0.5 size-4 shrink-0 text-brand-400" aria-label="Falta" />
                        )}
                        <span>
                          {r.label}
                          {r.detail && <span className="text-xs text-slate-500"> · {r.detail}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {e.status !== "na" &&
                  e.section.groups.map((g, gi) => {
                    const fields = applicable(g.fields, ctx);
                    if (!fields.length) return null;
                    return (
                      <div key={gi}>
                        {g.title && <h4 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{g.title}</h4>}
                        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                          {fields.map((f) => (
                            <FieldView key={f.key} f={f} data={e.data} ctx={ctx} files={files} />
                          ))}
                        </dl>
                      </div>
                    );
                  })}

                <p className="text-[11px] text-slate-400">
                  {e.updatedAt ? `Última edición: ${e.updatedBy ?? "—"} · ${formatDate(e.updatedAt, true)}` : "Sin datos todavía."}
                  {!canEdit && e.dept.leads.length > 0 && ` Lo completan los responsables de ${e.dept.name}.`}
                  {e.status === "done" && e.statusAt && ` · Terminado por ${e.statusBy} el ${formatDate(e.statusAt)}.`}
                </p>
              </div>
            </details>
          );
        })}
      </div>
    </Card>
  );
}
