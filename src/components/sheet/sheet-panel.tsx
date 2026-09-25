import { Check, ChevronDown, FileText, RotateCcw } from "lucide-react";
import type { UploadedFile } from "@/components/uploader";
import { Card, CardHeader } from "@/components/ui/card";
import { PHASES } from "@/lib/labels";
import type { DeptCard, SheetEntry } from "@/lib/server/sheet";
import { applicable, checkField, formatValue, resolveFieldRef, sanitizeData, type SheetCtx, type SheetData, type SheetField } from "@/lib/sheet/sections";
import { cn, formatBytes, formatDate } from "@/lib/utils";
import { DeptTransition } from "./dept-transition";
import { SectionEditor } from "./section-editor";

const SAGE = "bg-[#eef0e6] text-[#56613f] ring-natu-sage";
const DAY = 86_400_000;

function daysSince(d: Date | null, now: number) {
  return d ? Math.max(0, Math.floor((now - d.getTime()) / DAY)) : null;
}

/** Estado resumido de una tarjeta (chip). */
function StateChip({ c }: { c: DeptCard }) {
  const [label, cls] = c.completed
    ? ["Completado", SAGE]
    : !c.due
      ? ["Próximas fases", "bg-white text-slate-500 ring-slate-200"]
      : !c.started
        ? ["Sin empezar", "bg-slate-100 text-slate-600 ring-slate-300"]
        : [c.current?.name ?? "—", "bg-brand-50 text-brand-500 ring-brand-200"];
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1", cls)}>{label}</span>;
}

function Rounds({ n }: { n: number }) {
  if (n <= 1) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200" title="Veces que se ha vuelto a un estado anterior + 1">
      <RotateCcw className="size-3" aria-hidden /> Ronda {n}
    </span>
  );
}

/** Stepper horizontal de subestados con fechas de los completados y días en el actual. */
function Stepper({ c, now }: { c: DeptCard; now: number }) {
  const curIdx = c.current ? c.steps.findIndex((s) => s.id === c.current!.id) : 0;
  const days = daysSince(c.enteredAt, now);
  return (
    <ol className="flex gap-1 overflow-x-auto pb-1" aria-label={`Estados de ${c.dept.name}`}>
      {c.steps.map((s, i) => {
        const done = c.completed ? true : i < curIdx;
        const current = !c.completed && i === curIdx && c.started;
        return (
          <li key={s.id} className="flex min-w-24 flex-1 flex-col gap-1" aria-current={current ? "step" : undefined}>
            <div className="flex items-center gap-1">
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                  done ? "bg-[#7f8f63] text-white" : current ? "bg-white text-brand-500 ring-2 ring-brand-400" : "bg-slate-100 text-slate-400",
                )}
              >
                {done ? <Check className="size-3" aria-hidden /> : i + 1}
              </span>
              {i < c.steps.length - 1 && <span className={cn("h-0.5 flex-1 rounded-full", done ? "bg-[#7f8f63]" : "bg-slate-200")} aria-hidden />}
            </div>
            <p className={cn("text-xs leading-tight", current ? "font-semibold text-slate-900" : done ? "text-slate-700" : "text-slate-400")}>{s.name}</p>
            <p className="text-[11px] text-slate-500">
              {done && s.doneAt ? formatDate(s.doneAt) : current ? `${days ?? 0} día${days === 1 ? "" : "s"}` : " "}
            </p>
          </li>
        );
      })}
    </ol>
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

function FieldView({ f, data, files }: { f: SheetField; data: SheetData; files: UploadedFile[] }) {
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
  const v = formatValue(f, data[f.key]);
  return (
    <div className={cn("min-w-0", (f.type === "textarea" || f.type === "multi") && "sm:col-span-2")}>
      <dt className="text-xs text-slate-500">{f.label}</dt>
      <dd className={cn("whitespace-pre-line break-words text-sm", v ? "text-slate-900" : "text-slate-300")}>{v ?? "—"}</dd>
    </div>
  );
}

/** Campos exigidos por un subestado que aún no tienen valor válido (sin contar los que se piden en el propio diálogo). */
function missingFor(refs: string[], prompt: string[], entries: SheetEntry[]) {
  return refs
    .filter((ref) => !prompt.includes(ref))
    .map((ref) => {
      const r = resolveFieldRef(ref);
      const e = r && entries.find((x) => x.section.key === r.section.key);
      if (!r || !e) return null;
      const res = checkField(r.field, sanitizeData(r.section, e.data));
      return res.ok ? null : res.label;
    })
    .filter((x): x is string => !!x);
}

/** Resumen lateral: en qué subestado está cada departamento. */
export function SheetSummary({ cards, now }: { cards: DeptCard[]; now: number }) {
  const done = cards.filter((c) => c.completed).length;
  return (
    <Card className="h-full">
      <CardHeader
        title="Estado por departamento"
        description="En qué punto está cada departamento."
        actions={
          <span className="text-xs text-slate-500">
            <b className="text-base font-bold tabular-nums text-slate-900">{done}</b> de {cards.length} completados
          </span>
        }
      />
      <ul className="divide-y divide-slate-100">
        {cards.map((c) => {
          const idx = c.current ? c.steps.findIndex((s) => s.id === c.current!.id) : 0;
          const pos = c.completed ? c.steps.length : c.started ? idx + 1 : 0;
          const days = daysSince(c.enteredAt, now);
          return (
            <li key={c.dept.key} className={cn("px-5 py-3", !c.due && !c.started && "opacity-70")}>
              <div className="flex items-start gap-3">
                <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: c.dept.color }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <a href={`#dept-${c.dept.key}`} className="font-medium text-slate-900 hover:underline">
                      {c.dept.name}
                    </a>
                    <span className="flex items-center gap-1.5">
                      <Rounds n={c.rounds} />
                      <StateChip c={c} />
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                      <span className={cn("block h-full rounded-full", c.completed ? "bg-[#7f8f63]" : "bg-brand-400")} style={{ width: `${(pos / Math.max(1, c.steps.length)) * 100}%` }} />
                    </div>
                    <span className="tabular-nums">
                      {pos}/{c.steps.length}
                    </span>
                    <span>
                      ·{" "}
                      {c.completed
                        ? `completado el ${formatDate(c.completedAt)}`
                        : c.started
                          ? `${days} día${days === 1 ? "" : "s"} en este estado`
                          : `Fase ${c.phase} · ${PHASES[c.phase]?.short}`}
                    </span>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Tarjetas por departamento: stepper de subestados, avance/retroceso y detalles plegables. */
export function SheetPanel({
  projectId,
  cards,
  entries,
  ctx,
  files,
  editable,
  maxMb,
  now,
}: {
  projectId: string;
  cards: DeptCard[];
  entries: SheetEntry[];
  ctx: SheetCtx;
  files: UploadedFile[];
  editable: Record<string, boolean>;
  maxMb: number;
  now: number;
}) {
  return (
    <Card id="ficha">
      <CardHeader
        title="Departamentos"
        description="Cada departamento avanza por sus estados. Solo sus miembros (y el decisor global) pueden cambiar el estado y editar sus datos."
      />
      <div className="divide-y divide-slate-100">
        {cards.map((c) => {
          const canEdit = editable[c.dept.key] ?? false;
          const deps = [...new Set(c.entries.flatMap((e) => e.section.dependsOn ?? []))];
          const promptValues = (refs: string[]) =>
            Object.fromEntries(
              refs.map((ref) => {
                const r = resolveFieldRef(ref);
                const e = r && entries.find((x) => x.section.key === r.section.key);
                return [ref, r && e ? e.data[r.field.key] : undefined];
              }),
            );
          return (
            <section key={c.dept.key} id={`dept-${c.dept.key}`} className="flex scroll-mt-24 flex-col gap-3 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 font-semibold text-slate-900">
                  <span className="size-2.5 rounded-full" style={{ background: c.dept.color }} aria-hidden />
                  {c.dept.name}
                  <span className="text-xs font-normal text-slate-500">· {c.entries.map((e) => e.title).join(" · ")}</span>
                </h3>
                <span className="flex items-center gap-1.5">
                  <Rounds n={c.rounds} />
                  <StateChip c={c} />
                </span>
              </div>

              {c.steps.length ? (
                <Stepper c={c} now={now} />
              ) : (
                <p className="text-sm text-slate-500">Este departamento no tiene estados configurados (Backoffice → Estados de departamento).</p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-500">
                  {c.completed
                    ? `Completado el ${formatDate(c.completedAt)}.`
                    : c.started
                      ? `En «${c.current?.name}» desde el ${formatDate(c.enteredAt)}.`
                      : c.due
                        ? "Aún no ha empezado."
                        : `Empieza en la fase ${c.phase} · ${PHASES[c.phase]?.name}.`}
                </p>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    {c.backTargets.length > 0 && (
                      <DeptTransition
                        projectId={projectId}
                        departmentId={c.dept.id}
                        deptName={c.dept.name}
                        direction="back"
                        targets={c.backTargets.map((t) => ({ id: t.id, name: t.name, isFinal: t.isFinal, promptFields: [], missing: [] }))}
                        initialValues={{}}
                      />
                    )}
                    {c.next && (
                      <DeptTransition
                        projectId={projectId}
                        departmentId={c.dept.id}
                        deptName={c.dept.name}
                        direction="forward"
                        targets={[
                          {
                            id: c.next.id,
                            name: c.next.name,
                            isFinal: c.next.isFinal,
                            promptFields: c.next.promptFields,
                            missing: missingFor(c.next.requiredFields, c.next.promptFields, entries),
                          },
                        ]}
                        initialValues={promptValues(c.next.promptFields)}
                      />
                    )}
                  </div>
                )}
              </div>

              <details className="group rounded-lg border border-slate-200">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  <ChevronDown className="size-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
                  Ver detalles
                </summary>
                <div className="flex flex-col gap-5 border-t border-slate-100 p-4">
                  {deps.length > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Información de partida</p>
                      <ul className="flex flex-col gap-1.5">
                        {deps.map((key) => {
                          const dep = entries.find((x) => x.section.key === key);
                          const depCard = dep && cards.find((x) => x.dept.key === dep.dept.key);
                          if (!dep) return null;
                          return (
                            <li key={key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                              <a href={`#dept-${dep.dept.key}`} className="hover:underline">
                                <span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: dep.dept.color }} aria-hidden />
                                {dep.title} <span className="text-xs text-slate-500">· {dep.dept.name}</span>
                              </a>
                              {depCard && <StateChip c={depCard} />}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {c.entries.map((e) => (
                    <div key={e.section.key} className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-slate-900">{e.title}</h4>
                        {canEdit && (
                          <SectionEditor projectId={projectId} sectionKey={e.section.key} title={e.title} ctx={ctx} initial={e.data} files={files} maxMb={maxMb} />
                        )}
                      </div>
                      {e.section.groups.map((g, gi) => {
                        const fields = applicable(g.fields, ctx);
                        if (!fields.length) return null;
                        return (
                          <div key={gi}>
                            {g.title && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{g.title}</p>}
                            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                              {fields.map((f) => (
                                <FieldView key={f.key} f={f} data={e.data} files={files} />
                              ))}
                            </dl>
                          </div>
                        );
                      })}
                      <p className="text-[11px] text-slate-400">
                        {e.updatedAt ? `Última edición: ${e.updatedBy ?? "—"} · ${formatDate(e.updatedAt, true)}` : "Sin datos todavía."}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            </section>
          );
        })}
      </div>
    </Card>
  );
}
