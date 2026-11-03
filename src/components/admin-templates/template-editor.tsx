"use client";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { saveTemplateAction, type TemplateInput } from "@/app/actions/templates";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import type { Option } from "@/lib/catalog-defaults";
import { CATEGORY_LABEL, PHASES, TYPE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

type Task = TemplateInput["tasks"][number] & { description: string };
export type EditorTemplate = Omit<TemplateInput, "tasks"> & { tasks: Task[] };
type Dept = { id: number; name: string; color: string; isActive: boolean };

const TYPES = ["PL", "MP", "MDD"] as const;
const CATEGORIES = Object.entries(CATEGORY_LABEL) as [string, string][];
const RUNNING_PHASES = PHASES.filter((p) => p.n >= 1);

let seq = 0;
const newKey = () => `n${Date.now().toString(36)}${seq++}`;
const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));

/** Editor de una plantilla de flujo: datos, a qué proyectos aplica y tareas por fase. */
export function TemplateEditor({ initial, departments, subtypes }: { initial: EditorTemplate; departments: Dept[]; subtypes: Option[] }) {
  const router = useRouter();
  const [tpl, setTpl] = React.useState<EditorTemplate>(initial);
  const [open, setOpen] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const activeDepts = departments.filter((d) => d.isActive);

  const set = (patch: Partial<EditorTemplate>) => setTpl((t) => ({ ...t, ...patch }));
  const setApplies = (k: keyof EditorTemplate["appliesTo"], v: string, on: boolean) =>
    setTpl((t) => ({ ...t, appliesTo: { ...t.appliesTo, [k]: toggle(t.appliesTo[k] as string[], v, on) } }));
  const setTask = (key: string, patch: Partial<Task>) => setTpl((t) => ({ ...t, tasks: t.tasks.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));

  function addTask(phase: number) {
    const key = newKey();
    setTpl((t) => ({
      ...t,
      tasks: [...t.tasks, { key, phase, departmentId: activeDepts[0]?.id ?? departments[0]!.id, title: "", description: "", isRequired: true, estDays: 5, deps: [], returnsTo: null }],
    }));
    setOpen(key);
  }
  function removeTask(key: string) {
    setTpl((t) => ({
      ...t,
      tasks: t.tasks.filter((x) => x.key !== key).map((x) => ({ ...x, deps: x.deps.filter((d) => d !== key), returnsTo: x.returnsTo === key ? null : x.returnsTo })),
    }));
  }
  function move(key: string, dir: -1 | 1) {
    setTpl((t) => {
      const list = [...t.tasks];
      const i = list.findIndex((x) => x.key === key);
      const phase = list[i]!.phase;
      // Siguiente/anterior tarea de la misma fase
      let j = i + dir;
      while (j >= 0 && j < list.length && list[j]!.phase !== phase) j += dir;
      if (j < 0 || j >= list.length) return t;
      [list[i], list[j]] = [list[j]!, list[i]!];
      return { ...t, tasks: list };
    });
  }
  function changePhase(key: string, phase: number) {
    // Al cambiar de fase se quitan las dependencias que quedarían en una fase posterior
    setTpl((t) => {
      const phaseOf = new Map(t.tasks.map((x) => [x.key, x.key === key ? phase : x.phase]));
      return {
        ...t,
        tasks: t.tasks.map((x) => {
          const next = x.key === key ? { ...x, phase } : x;
          return { ...next, deps: next.deps.filter((d) => phaseOf.get(d)! <= next.phase) };
        }),
      };
    });
  }

  async function save() {
    setBusy(true);
    const ordered = RUNNING_PHASES.flatMap((p) => tpl.tasks.filter((x) => x.phase === p.n));
    const res = await saveTemplateAction({ ...tpl, tasks: ordered.map((x) => ({ ...x, description: x.description.trim() || null })) });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(tpl.id ? "Plantilla guardada" : "Plantilla creada");
    if (!tpl.id && res.id) router.replace(`/admin/plantillas/${res.id}`);
    else router.refresh();
  }

  const deptName = (id: number) => departments.find((d) => d.id === id);
  const involved = [...new Set(tpl.tasks.map((x) => x.departmentId))].map(deptName).filter(Boolean) as Dept[];
  const showSubtypes = !tpl.appliesTo.types.length || tpl.appliesTo.types.some((t) => t !== "MP");

  return (
    <div className="flex flex-col gap-4 pb-20">
      <Card className="grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Nombre de la plantilla" required htmlFor="tpl-name">
          <Input id="tpl-name" value={tpl.name} onChange={(e) => set({ name: e.target.value })} placeholder="p. ej. PL/MDD – Desarrollo completo…" maxLength={200} />
        </Field>
        <Checkbox label="Activa (se propone al aprobar P1)" checked={tpl.isActive} onChange={(e) => set({ isActive: e.target.checked })} className="pb-2" />
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-900">Aplica a</h2>
        <p className="mb-3 text-xs text-slate-500">Si no marcas nada en un grupo, aplica a todos. Al aprobar P1 se propone la plantilla que mejor encaja.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Tipo</legend>
            <div className="flex flex-col gap-1.5">
              {TYPES.map((t) => (
                <Checkbox key={t} label={TYPE_LABEL[t]} checked={tpl.appliesTo.types.includes(t)} onChange={(e) => setApplies("types", t, e.target.checked)} />
              ))}
            </div>
          </fieldset>
          {showSubtypes && (
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Subtipo (marca privada / distribuidor)</legend>
              <div className="flex flex-col gap-1.5">
                {subtypes.map((s) => (
                  <Checkbox key={s.value} label={s.label} checked={tpl.appliesTo.subtypes.includes(s.value)} onChange={(e) => setApplies("subtypes", s.value, e.target.checked)} />
                ))}
              </div>
            </fieldset>
          )}
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Categoría</legend>
            <div className="flex flex-col gap-1.5">
              {CATEGORIES.map(([v, l]) => (
                <Checkbox key={v} label={l} checked={tpl.appliesTo.categories.includes(v)} onChange={(e) => setApplies("categories", v, e.target.checked)} />
              ))}
            </div>
          </fieldset>
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Tareas por fase</h2>
          <p className="text-xs text-slate-500">
            Departamentos que se propondrán: {involved.length ? involved.map((d) => d.name).join(", ") : "ninguno todavía"}
          </p>
        </div>
        <div className="flex flex-col gap-5">
          {RUNNING_PHASES.map((ph) => {
            const list = tpl.tasks.filter((x) => x.phase === ph.n);
            return (
              <section key={ph.n}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Fase {ph.n} · {ph.name}
                </h3>
                <ul className="flex flex-col gap-2">
                  {list.map((x, idx) => {
                    const expanded = open === x.key;
                    const candidates = tpl.tasks.filter((o) => o.key !== x.key && o.phase <= x.phase);
                    const dept = deptName(x.departmentId);
                    return (
                      <li key={x.key} className="rounded-lg border border-slate-200 bg-white">
                        <div className="flex flex-wrap items-center gap-2 p-2">
                          <button
                            type="button"
                            onClick={() => setOpen(expanded ? null : x.key)}
                            className="rounded p-1 text-slate-500 hover:bg-slate-100"
                            aria-label={expanded ? "Ocultar detalles" : "Ver detalles"}
                            aria-expanded={expanded}
                          >
                            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          </button>
                          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: dept?.color }} aria-hidden />
                          <Select value={x.departmentId} onChange={(e) => setTask(x.key, { departmentId: Number(e.target.value) })} className="h-8 w-44 text-xs" aria-label="Departamento">
                            {departments.map((d) => (
                              <option key={d.id} value={d.id} disabled={!d.isActive && d.id !== x.departmentId}>
                                {d.name}
                                {!d.isActive ? " (inactivo)" : ""}
                              </option>
                            ))}
                          </Select>
                          <Input
                            value={x.title}
                            onChange={(e) => setTask(x.key, { title: e.target.value })}
                            placeholder="Título de la tarea…"
                            className={cn("h-8 min-w-48 flex-1 text-sm", !x.title.trim() && "border-amber-300")}
                            aria-label="Título de la tarea"
                            maxLength={200}
                          />
                          <label className="flex items-center gap-1 text-xs text-slate-600">
                            <Input
                              type="number"
                              min={0}
                              max={365}
                              value={x.estDays}
                              onChange={(e) => setTask(x.key, { estDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })}
                              className="h-8 w-16 text-xs"
                              aria-label="Días estimados"
                            />
                            días
                          </label>
                          <Checkbox label="Obligatoria" checked={x.isRequired} onChange={(e) => setTask(x.key, { isRequired: e.target.checked })} className="text-xs" />
                          <div className="ml-auto flex items-center">
                            <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30" disabled={idx === 0} onClick={() => move(x.key, -1)} aria-label="Subir">
                              <ArrowUp className="size-4" />
                            </button>
                            <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30" disabled={idx === list.length - 1} onClick={() => move(x.key, 1)} aria-label="Bajar">
                              <ArrowDown className="size-4" />
                            </button>
                            <button type="button" className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => removeTask(x.key)} aria-label="Quitar tarea">
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </div>
                        {!expanded && (x.deps.length > 0 || x.returnsTo) && (
                          <p className="px-10 pb-2 text-xs text-slate-500">
                            {x.deps.length > 0 && <>← depende de {x.deps.map((d) => tpl.tasks.find((o) => o.key === d)?.title || "(sin título)").join(", ")} </>}
                            {x.returnsTo && <span className="text-amber-700">↺ puede devolver «{tpl.tasks.find((o) => o.key === x.returnsTo)?.title || "(sin título)"}»</span>}
                          </p>
                        )}
                        {expanded && (
                          <div className="grid gap-3 border-t border-slate-100 p-3 sm:grid-cols-2">
                            <Field label="Descripción" className="sm:col-span-2">
                              <Textarea value={x.description} onChange={(e) => setTask(x.key, { description: e.target.value })} placeholder="Qué hay que hacer (opcional)…" maxLength={2000} className="min-h-16" />
                            </Field>
                            <Field label="Fase">
                              <Select value={x.phase} onChange={(e) => changePhase(x.key, Number(e.target.value))}>
                                {RUNNING_PHASES.map((p) => (
                                  <option key={p.n} value={p.n}>
                                    Fase {p.n} · {p.name}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            <Field label="Puede devolver a" hint="Tarea anterior a la que se vuelve si hay que repetir (p. ej. una nueva ronda de fórmula).">
                              <Select value={x.returnsTo ?? ""} onChange={(e) => setTask(x.key, { returnsTo: e.target.value || null })}>
                                <option value="">— Ninguna —</option>
                                {tpl.tasks
                                  .filter((o) => o.key !== x.key)
                                  .map((o) => (
                                    <option key={o.key} value={o.key}>
                                      F{o.phase} · {o.title || "(sin título)"}
                                    </option>
                                  ))}
                              </Select>
                            </Field>
                            <fieldset className="sm:col-span-2">
                              <legend className="mb-1.5 text-sm font-medium text-slate-700">Depende de</legend>
                              {candidates.length ? (
                                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                                  {candidates.map((o) => (
                                    <Checkbox
                                      key={o.key}
                                      label={`F${o.phase} · ${o.title || "(sin título)"}`}
                                      checked={x.deps.includes(o.key)}
                                      onChange={(e) => setTask(x.key, { deps: toggle(x.deps, o.key, e.target.checked) })}
                                      className="text-xs"
                                    />
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-500">No hay tareas anteriores de las que pueda depender.</p>
                              )}
                            </fieldset>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <button type="button" onClick={() => addTask(ph.n)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-800">
                  <Plus className="size-3.5" /> Añadir tarea
                </button>
              </section>
            );
          })}
        </div>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-2">
          <Button variant="ghost" asChild>
            <Link href="/admin/plantillas">Cancelar</Link>
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {tpl.id ? "Guardar cambios" : "Crear plantilla"}
          </Button>
        </div>
      </div>
    </div>
  );
}
