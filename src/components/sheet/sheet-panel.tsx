import { ArrowRight, Check, ChevronDown, ExternalLink, FileText, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import type { UploadedFile } from "@/components/uploader";
import { Card, CardHeader } from "@/components/ui/card";
import { PHASES } from "@/lib/labels";
import type { RefInfo } from "@/lib/server/references";
import type { DeptCard, DeptState, SheetEntry } from "@/lib/server/sheet";
import { applicable, checkField, fieldLabelInSection, formatValue, resolveFieldRef, sanitizeData, type SheetCtx, type SheetData, type SheetField } from "@/lib/sheet/sections";
import { cn, formatBytes, formatDate } from "@/lib/utils";
import { DeptTransition } from "./dept-transition";
import { FormulaCostBox } from "./formula-cost";
import { Button } from "@/components/ui/button";
import { SectionEditor } from "./section-editor";

const SAGE = "bg-[#7f8f63] text-white ring-[#7f8f63]";
const DAY = 86_400_000;
const CHIP = "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1";

function daysSince(d: Date | null, now: number) {
  return d ? Math.max(0, Math.floor((now - d.getTime()) / DAY)) : null;
}

const refTitle = (r: Pick<RefInfo, "label" | "name">) => (r.name && r.name !== `Referencia ${r.label}` ? `${r.label} · ${r.name}` : `Referencia ${r.label}`);

/** Estado resumido de una tarjeta (chip). Con varias referencias: cuántas están completadas. */
function StateChip({ c }: { c: DeptCard }) {
  if (c.perRef && !c.completed && c.due) {
    const done = c.refs.filter((r) => r.completed).length;
    return <span className={cn(CHIP, "bg-brand-50 text-brand-500 ring-brand-200")}>{`${done}/${c.refs.length} referencias`}</span>;
  }
  const [label, cls] = c.completed
    ? ["Completado", SAGE]
    : !c.due
      ? [c.waitsP2 ? "Tras P2" : "Próximas fases", "bg-white text-slate-500 ring-slate-200"]
      : !c.started
        ? ["Sin empezar", "bg-slate-100 text-slate-600 ring-slate-300"]
        : [c.current?.name ?? "—", "bg-brand-50 text-brand-500 ring-brand-200"];
  return <span className={cn(CHIP, cls)}>{label}</span>;
}

function RefChip({ s }: { s: DeptState }) {
  const [label, cls] = s.completed
    ? ["Completada", SAGE]
    : !s.started
      ? ["Sin empezar", "bg-slate-100 text-slate-600 ring-slate-300"]
      : [s.current?.name ?? "—", "bg-brand-50 text-brand-500 ring-brand-200"];
  return <span className={cn(CHIP, cls)}>{label}</span>;
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
function Stepper({ s, label, now }: { s: DeptState; label: string; now: number }) {
  const curIdx = s.current ? s.steps.findIndex((x) => x.id === s.current!.id) : 0;
  const days = daysSince(s.enteredAt, now);
  return (
    <ol className="flex gap-1 overflow-x-auto pb-1" aria-label={`Estados de ${label}`}>
      {s.steps.map((step, i) => {
        const done = s.completed ? true : i < curIdx;
        const current = !s.completed && i === curIdx && s.started;
        return (
          <li key={step.id} className="flex min-w-24 flex-1 flex-col gap-1" aria-current={current ? "step" : undefined}>
            <div className="flex items-center gap-1">
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                  done ? "bg-[#7f8f63] text-white" : current ? "bg-white text-brand-500 ring-2 ring-brand-400" : "bg-slate-100 text-slate-400",
                )}
              >
                {done ? <Check className="size-3" aria-hidden /> : i + 1}
              </span>
              {i < s.steps.length - 1 && <span className={cn("h-0.5 flex-1 rounded-full", done ? "bg-[#7f8f63]" : "bg-slate-200")} aria-hidden />}
            </div>
            <p className={cn("text-xs leading-tight", current ? "font-semibold text-slate-900" : done ? "text-slate-700" : "text-slate-400")}>{step.name}</p>
            <p className="text-[11px] text-slate-500">{done && step.doneAt ? formatDate(step.doneAt) : current ? `${days ?? 0} día${days === 1 ? "" : "s"}` : " "}</p>
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
  if (f.type === "url") {
    return (
      <div className="min-w-0 sm:col-span-2">
        <dt className="text-xs text-slate-500">{f.label}</dt>
        <dd className="text-sm">
          {v ? (
            <a href={v} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 font-medium text-brand-600 underline underline-offset-2 hover:text-brand-800">
              <ExternalLink className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{/sharepoint\.com/i.test(v) ? "Abrir en SharePoint" : /onedrive|1drv\.ms/i.test(v) ? "Abrir en OneDrive" : v}</span>
            </a>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </dd>
      </div>
    );
  }
  return (
    <div className={cn("min-w-0", (f.type === "textarea" || f.type === "multi") && "sm:col-span-2")}>
      <dt className="text-xs text-slate-500">{f.label}</dt>
      <dd className={cn("whitespace-pre-line break-words text-sm", v ? "text-slate-900" : "text-slate-300")}>{v ?? "—"}</dd>
    </div>
  );
}

/** Apartados visibles para una referencia: los suyos y los comunes. */
const entriesFor = (entries: SheetEntry[], refId: number) => entries.filter((e) => e.refId === 0 || e.refId === refId);

/** Campos exigidos por un subestado que aún no tienen valor válido (sin contar los que se piden en el propio diálogo). */
function missingRefs(refs: string[], prompt: string[], entries: SheetEntry[]) {
  return refs
    .filter((ref) => !prompt.includes(ref))
    .map((ref) => {
      const r = resolveFieldRef(ref);
      const e = r && entries.find((x) => x.section.key === r.section.key);
      if (!r || !e) return null;
      const res = checkField(r.field, sanitizeData(r.section, e.data));
      return res.ok ? null : { label: fieldLabelInSection(r.section, r.field.key), entry: e, field: r.field.key };
    })
    .filter((x): x is { label: string; entry: SheetEntry; field: string } => !!x);
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
          const doneRefs = c.refs.filter((r) => r.completed).length;
          const [pos, total] = c.perRef ? [doneRefs, c.refs.length] : [c.completed ? c.steps.length : c.started ? idx + 1 : 0, c.steps.length];
          const days = daysSince(c.enteredAt, now);
          return (
            <li key={c.dept.key} className={cn("px-5 py-3", c.completed && "border-l-4 border-l-[#7f8f63] bg-[#f4f6ee]", !c.due && !c.started && "opacity-70")}>
              <div className="flex items-start gap-3">
                <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: c.dept.color }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <a href={`#dept-${c.dept.key}`} className="font-medium text-slate-900 hover:underline">
                      {c.dept.name}
                    </a>
                    <span className="flex items-center gap-1.5">
                      {!c.perRef && <Rounds n={c.rounds} />}
                      <StateChip c={c} />
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                      <span className={cn("block h-full rounded-full", c.completed ? "bg-[#7f8f63]" : "bg-brand-400")} style={{ width: `${(pos / Math.max(1, total)) * 100}%` }} />
                    </div>
                    <span className="tabular-nums">
                      {pos}/{total}
                    </span>
                    <span>
                      ·{" "}
                      {c.completed
                        ? `completado el ${formatDate(c.completedAt)}`
                        : c.perRef && c.due
                          ? "referencias completadas"
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

type PanelCtx = {
  projectId: string;
  cards: DeptCard[];
  entries: SheetEntry[];
  ctx: SheetCtx;
  files: UploadedFile[];
  maxMb: number;
  now: number;
};

/** Texto de estado + botones de avanzar/retroceder (de un departamento o de una referencia). */
function StateRow({ c, s, canEdit, refInfo, pc }: { c: DeptCard; s: DeptState; canEdit: boolean; refInfo: RefInfo | null; pc: PanelCtx }) {
  const scope = refInfo ? entriesFor(pc.entries, refInfo.id) : pc.entries.filter((e) => e.refId === 0);
  const deptName = refInfo ? `${c.dept.name} · ${refTitle(refInfo)}` : c.dept.name;
  const promptValues = (refs: string[]) =>
    Object.fromEntries(
      refs.map((ref) => {
        const r = resolveFieldRef(ref);
        const e = r && scope.find((x) => x.section.key === r.section.key);
        return [ref, r && e ? e.data[r.field.key] : undefined];
      }),
    );
  // Lo que falta para el siguiente estado se ve antes de pulsar, con acceso directo a rellenarlo
  const missing = canEdit && !c.auto && s.next ? missingRefs(s.next.requiredFields, s.next.promptFields, scope) : [];
  const firstMissing = missing[0]?.entry;
  return (
    <div className="flex flex-col gap-2">
      {missing.length > 0 && s.next && firstMissing && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
          <p className="min-w-0">
            Para pasar a <strong>«{s.next.name}»</strong> falta: {missing.map((m) => m.label).join(" · ")}.
          </p>
          <SectionEditor
            projectId={pc.projectId}
            sectionKey={firstMissing.section.key}
            referenceId={refInfo?.id}
            title={refInfo ? `${firstMissing.title} · ${refTitle(refInfo)}` : firstMissing.title}
            ctx={pc.ctx}
            initial={firstMissing.data}
            files={pc.files}
            maxMb={pc.maxMb}
            triggerLabel="Completar datos"
            required={missing.filter((m) => m.entry === firstMissing).map((m) => m.field)}
          />
        </div>
      )}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-slate-500">
        {s.completed
          ? `Completado el ${formatDate(s.completedAt)}.`
          : s.started
            ? `En «${s.current?.name}» desde el ${formatDate(s.enteredAt)}.`
            : c.due
              ? "Aún no ha empezado."
              : c.waitsP2
                ? "Se activa cuando el cliente aprueba el presupuesto (P2)."
                : `Empieza en la fase ${c.phase} · ${PHASES[c.phase]?.name}.`}
      </p>
      {c.auto && !c.completed && c.active && (
        <p className="text-xs text-slate-500">Avanza con los botones de arriba: «Enviar cotización al comercial» y «Registrar respuesta del cliente (P2)».</p>
      )}
      {canEdit && !c.auto && (
        <div className="flex items-center gap-2">
          {s.backTargets.length > 0 && (
            <DeptTransition
              projectId={pc.projectId}
              departmentId={c.dept.id}
              referenceId={refInfo?.id}
              deptName={deptName}
              direction="back"
              targets={s.backTargets.map((t) => ({ id: t.id, name: t.name, isFinal: t.isFinal, promptFields: [], missing: [] }))}
              initialValues={{}}
            />
          )}
          {s.next && missing.length > 0 && (
            <Button size="sm" disabled title="Completa antes los datos que faltan">
              <ArrowRight aria-hidden /> Avanzar a «{s.next.name}»
            </Button>
          )}
          {s.next && !missing.length && (
            <DeptTransition
              projectId={pc.projectId}
              departmentId={c.dept.id}
              referenceId={refInfo?.id}
              deptName={deptName}
              direction="forward"
              targets={[
                {
                  id: s.next.id,
                  name: s.next.name,
                  isFinal: s.next.isFinal,
                  promptFields: s.next.promptFields,
                  missing: [],
                },
              ]}
              initialValues={promptValues(s.next.promptFields)}
            />
          )}
        </div>
      )}
    </div>
    </div>
  );
}

/** Apartados (datos) de un departamento, comunes o de una referencia. */
function EntriesView({ list, canEdit, refInfo, pc }: { list: SheetEntry[]; canEdit: boolean; refInfo: RefInfo | null; pc: PanelCtx }) {
  return (
    <>
      {list.map((e) => (
        <div key={`${e.section.key}-${e.refId}`} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-900">{e.title}</h4>
            {canEdit && (
              <SectionEditor
                projectId={pc.projectId}
                sectionKey={e.section.key}
                referenceId={refInfo?.id}
                title={refInfo ? `${e.title} · ${refTitle(refInfo)}` : e.title}
                ctx={pc.ctx}
                initial={e.data}
                files={pc.files}
                maxMb={pc.maxMb}
              />
            )}
          </div>
          {e.section.groups.map((g, gi) => {
            const fields = applicable(g.fields, pc.ctx);
            if (!fields.length) return null;
            return (
              <div key={gi}>
                {g.title && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{g.title}</p>}
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {fields.map((f) => (
                    <FieldView key={f.key} f={f} data={e.data} files={pc.files} />
                  ))}
                </dl>
              </div>
            );
          })}
          <p className="text-[11px] text-slate-400">{e.updatedAt ? `Última edición: ${e.updatedBy ?? "—"} · ${formatDate(e.updatedAt, true)}` : "Sin datos todavía."}</p>
        </div>
      ))}
    </>
  );
}

/** Información de partida: apartados de otros departamentos que necesita este. */
function Inputs({ deps, pc }: { deps: string[]; pc: PanelCtx }) {
  if (!deps.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Información de partida</p>
        <a href={`/proyectos/${pc.projectId}/ficha`} className="text-xs font-medium text-brand-600 hover:text-brand-800">
          Ver toda la ficha en una página →
        </a>
      </div>
      <ul className="flex flex-col gap-1.5">
        {deps.map((key) => {
          const dep = pc.entries.find((x) => x.section.key === key);
          const depCard = dep && pc.cards.find((x) => x.dept.key === dep.dept.key);
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
  );
}

function Details({ label = "Ver detalles", open, children }: { label?: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-slate-200 bg-white" open={open || undefined}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
        <ChevronDown className="size-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
        {label}
      </summary>
      <div className="flex flex-col gap-5 border-t border-slate-100 p-4">{children}</div>
    </details>
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
  formulaCost,
  mine = [],
}: PanelCtx & {
  editable: Record<string, boolean>;
  /** Coste objetivo de la fórmula (confidencial); undefined si el usuario no puede verlo. */
  formulaCost?: number | null;
  /** Departamentos de la persona: van primero y destacados. */
  mine?: string[];
}) {
  const pc: PanelCtx = { projectId, cards, entries, ctx, files, maxMb, now };
  const ordered = [...cards.filter((c) => mine.includes(c.dept.key)), ...cards.filter((c) => !mine.includes(c.dept.key))];
  const firstOther = ordered.findIndex((c) => !mine.includes(c.dept.key));
  return (
    <Card id="ficha">
      <CardHeader
        title="Departamentos"
        description="Cada departamento avanza por sus estados (por referencia si el proyecto tiene varias). Solo sus miembros (y el gestor de proyectos) pueden cambiar el estado y editar sus datos."
      />
      <div className="divide-y divide-slate-100">
        {ordered.map((c, idx) => {
          const own = mine.includes(c.dept.key);
          const canEdit = editable[c.dept.key] ?? false;
          const allEntries = [...c.entries, ...c.refs.flatMap((r) => r.entries)];
          const deps = [...new Set(allEntries.flatMap((e) => e.section.dependsOn ?? []))];
          const titles = [...new Set(allEntries.map((e) => e.title))];
          return (
            <section
              key={c.dept.key}
              id={`dept-${c.dept.key}`}
              className={cn(
                "flex scroll-mt-24 flex-col gap-3 px-5 py-4",
                c.completed && "border-l-4 border-l-[#7f8f63] bg-[#f4f6ee]",
                own && !c.completed && "border-l-4 border-l-natu-dark",
              )}
            >
              {mine.length > 0 && idx === firstOther && idx > 0 && (
                <p className="-mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Resto de departamentos</p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 font-semibold text-slate-900">
                  <span className="size-2.5 rounded-full" style={{ background: c.dept.color }} aria-hidden />
                  {c.dept.name}
                  {own && <span className="rounded-full bg-natu-dark px-2 py-0.5 text-[11px] font-medium text-white">Tu departamento</span>}
                  <span className="text-xs font-normal text-slate-500">· {titles.join(" · ")}</span>
                </h3>
                <span className="flex items-center gap-1.5">
                  {!c.perRef && <Rounds n={c.rounds} />}
                  <StateChip c={c} />
                </span>
              </div>

              {c.dept.key === "idi" && formulaCost !== undefined && <FormulaCostBox projectId={projectId} value={formulaCost} />}

              {!c.steps.length && <p className="text-sm text-slate-500">Este departamento no tiene estados configurados (Backoffice → Estados de departamento).</p>}

              {!c.perRef ? (
                <>
                  {c.steps.length > 0 && <Stepper s={c} label={c.dept.name} now={now} />}
                  <StateRow c={c} s={c} canEdit={canEdit} refInfo={null} pc={pc} />
                  <Details open={c.auto && !c.completed}>
                    <Inputs deps={deps} pc={pc} />
                    <EntriesView list={c.entries} canEdit={canEdit} refInfo={null} pc={pc} />
                  </Details>
                </>
              ) : (
                <>
                  {(deps.length > 0 || c.entries.length > 0) && (
                    <Details label="Común a todas las referencias">
                      <Inputs deps={deps} pc={pc} />
                      <EntriesView list={c.entries} canEdit={canEdit} refInfo={null} pc={pc} />
                    </Details>
                  )}
                  {c.refs.map((r) => (
                    <div
                      key={r.ref.id}
                      className={cn("flex flex-col gap-2 rounded-lg border p-3", r.completed ? "border-[#cdd5bd] bg-[#f4f6ee]" : "border-slate-200 bg-white")}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">{refTitle(r.ref)}</p>
                        <span className="flex items-center gap-1.5">
                          <Rounds n={r.rounds} />
                          <RefChip s={r} />
                        </span>
                      </div>
                      {r.steps.length > 0 && <Stepper s={r} label={`${c.dept.name} · ${refTitle(r.ref)}`} now={now} />}
                      <StateRow c={c} s={r} canEdit={canEdit} refInfo={r.ref} pc={pc} />
                      {r.entries.length > 0 && (
                        <Details>
                          <EntriesView list={r.entries} canEdit={canEdit} refInfo={r.ref} pc={pc} />
                        </Details>
                      )}
                    </div>
                  ))}
                </>
              )}
            </section>
          );
        })}
      </div>
    </Card>
  );
}


/**
 * «Tu parte en este proyecto»: lo que depende de la persona (sus departamentos y las
 * decisiones que le tocan), con los botones para completar y avanzar sin bajar a la ficha.
 */
export function MyWork({
  cards,
  mine,
  editable,
  actions,
  ...pc
}: PanelCtx & {
  mine: string[];
  editable: Record<string, boolean>;
  /** Tareas del proyecto que le tocan (P1, cotización, P2, datos de etiqueta…). */
  actions: { label: string; hint: string }[];
}) {
  const ctx: PanelCtx = { ...pc, cards };
  const myCards = cards.filter((c) => mine.includes(c.dept.key));
  if (!myCards.length && !actions.length) return null;
  const pending = myCards.filter((c) => !c.completed);
  const todo = actions.length + pending.filter((c) => c.active && c.due).length;
  return (
    <Card className="border-natu-dark/30 ring-1 ring-natu-dark/10">
      <CardHeader
        title="Tu parte en este proyecto"
        actions={
          <a href={`/proyectos/${pc.projectId}/ficha`} className="text-xs font-medium text-brand-600 hover:text-brand-800">
            Toda la información del proyecto →
          </a>
        }
        description={
          todo
            ? `Tienes ${todo} ${todo === 1 ? "cosa" : "cosas"} pendiente${todo === 1 ? "" : "s"}. El resto de departamentos, más abajo.`
            : "Ahora mismo no tienes nada pendiente aquí."
        }
      />
      <div className="flex flex-col divide-y divide-slate-100">
        {actions.map((a) => (
          <div key={a.label} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
            <p className="text-sm">
              <span className="font-medium text-slate-900">{a.label}</span>
              <span className="block text-xs text-slate-500">{a.hint}</span>
            </p>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">Te toca</span>
          </div>
        ))}
        {myCards.map((c) => {
          const canEdit = editable[c.dept.key] ?? false;
          const head = (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <span className="size-2.5 rounded-full" style={{ background: c.dept.color }} aria-hidden />
                {c.dept.name}
              </p>
              <a href={`#dept-${c.dept.key}`} className="text-xs font-medium text-brand-600 hover:text-brand-800">
                Ver todos mis datos ↓
              </a>
            </div>
          );
          if (c.completed)
            return (
              <div key={c.dept.key} className="flex flex-col gap-1 px-5 py-3">
                {head}
                <p className="flex items-center gap-1 text-sm text-[#56613f]">
                  <Check className="size-4" aria-hidden /> Tu parte está completada{c.completedAt ? ` (${formatDate(c.completedAt)})` : ""}.
                </p>
              </div>
            );
          if (!c.active || !c.due)
            return (
              <div key={c.dept.key} className="flex flex-col gap-1 px-5 py-3">
                {head}
                <p className="text-sm text-slate-500">
                  {c.waitsP2 ? "Tu parte empieza cuando el cliente apruebe el presupuesto (P2)." : `Tu parte empieza en la fase ${c.phase} · ${PHASES[c.phase]?.name}.`}
                  {canEdit && c.active && " Si quieres, puedes ir adelantando datos."}
                </p>
              </div>
            );
          return (
            <div key={c.dept.key} className="flex flex-col gap-3 px-5 py-3">
              {head}
              {!c.perRef ? (
                <StateRow c={c} s={c} canEdit={canEdit} refInfo={null} pc={ctx} />
              ) : (
                c.refs
                  .filter((r) => !r.completed)
                  .map((r) => (
                    <div key={r.ref.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
                      <p className="text-sm font-semibold text-slate-900">{refTitle(r.ref)}</p>
                      <StateRow c={c} s={r} canEdit={canEdit} refInfo={r.ref} pc={ctx} />
                    </div>
                  ))
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
