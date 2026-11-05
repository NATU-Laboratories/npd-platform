"use client";
import { Clock, FlaskConical, Loader2, Lock, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { addRepLabNoteAction } from "@/app/actions/replenishments";
import { addDeptNoteAction } from "@/app/actions/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import type { NoteView, SampleView } from "@/lib/server/lab";
import { cn, formatDate } from "@/lib/utils";

const STATUS: Record<string, [string, string]> = {
  evaluation: ["En evaluación", "bg-amber-50 text-amber-800 ring-amber-200"],
  approved: ["Aprobada", "bg-[#eef0e6] text-[#56613f] ring-natu-sage"],
  not_approved: ["No aprobada", "bg-slate-100 text-slate-500 ring-slate-200"],
};

/** Bitácora de Laboratorio: notas del trabajo en curso y esperas (con su motivo). */
export function LabNotes({ projectId, repId, notes, canWrite, limit }: { projectId?: string; repId?: string; notes: NoteView[]; canWrite: boolean; limit?: number }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [wait, setWait] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [all, setAll] = React.useState(false);
  const shown = limit && !all ? notes.slice(0, limit) : notes;
  async function add() {
    setBusy(true);
    const res = repId ? await addRepLabNoteAction(repId, body, wait) : await addDeptNoteAction(projectId!, "idi", body, wait);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setBody("");
    setWait(false);
    router.refresh();
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bitácora de Laboratorio</p>
      {canWrite && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={wait ? "Motivo de la espera (p. ej. a la espera de la materia prima X)…" : "Qué estáis haciendo, pruebas, avances…"}
            aria-label="Nota para la bitácora de Laboratorio"
            maxLength={4000}
            className="min-h-14"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-700">
              <input type="checkbox" checked={wait} onChange={(e) => setWait(e.target.checked)} className="size-4 accent-amber-500" />
              Es una espera (el trabajo está parado)
            </label>
            <Button size="sm" variant="secondary" onClick={add} disabled={busy || !body.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Send aria-hidden />} Añadir nota
            </Button>
          </div>
        </div>
      )}
      {!notes.length && <p className="text-xs text-slate-400">Todavía no hay notas.</p>}
      <ul className="flex flex-col gap-1.5">
        {shown.map((n) => (
          <li key={n.id} className={cn("rounded-md px-2.5 py-1.5 text-sm", n.isWait ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-800")}>
            {n.isWait && (
              <span className="mr-1 inline-flex items-center gap-0.5 text-xs font-semibold">
                <Clock className="size-3" aria-hidden /> Espera:
              </span>
            )}
            <span className="whitespace-pre-line">{n.body}</span>
            <span className="mt-0.5 block text-[11px] text-slate-400">
              {n.by ?? "—"} · {formatDate(n.createdAt, true)}
            </span>
          </li>
        ))}
      </ul>
      {limit && notes.length > limit && !all && (
        <button type="button" onClick={() => setAll(true)} className="self-start text-xs font-medium text-brand-600 hover:text-brand-800">
          Ver todas ({notes.length})
        </button>
      )}
    </div>
  );
}

/** Muestras que Laboratorio ha pasado a evaluación (la fórmula solo se ve con permiso). */
export function LabSamples({ samples, canSeeFormula, refNames }: { samples: SampleView[]; canSeeFormula: boolean; refNames?: Record<number, string> }) {
  if (!samples.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <FlaskConical className="size-3.5" aria-hidden /> Muestras
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-slate-500">
              <th className="py-1 pr-3 font-medium">Cód. referencia</th>
              {refNames && <th className="py-1 pr-3 font-medium">Referencia</th>}
              <th className="py-1 pr-3 font-medium">Ronda</th>
              <th className="py-1 pr-3 font-medium">Estado</th>
              <th className="py-1 font-medium">
                Fórmula {!canSeeFormula && <Lock className="inline size-3" aria-label="confidencial" />}
              </th>
            </tr>
          </thead>
          <tbody>
            {samples.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 align-top">
                <td className="py-1.5 pr-3 font-medium text-slate-900">{s.code}</td>
                {refNames && <td className="py-1.5 pr-3 text-xs text-slate-600">{refNames[s.referenceId] ?? "—"}</td>}
                <td className="py-1.5 pr-3 tabular-nums">{s.round}</td>
                <td className="py-1.5 pr-3">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs ring-1", STATUS[s.status]?.[1])}>{STATUS[s.status]?.[0] ?? s.status}</span>
                </td>
                <td className="py-1.5 text-xs text-slate-700">
                  {canSeeFormula ? <span className="whitespace-pre-line">{s.formula || "—"}</span> : <span className="text-slate-400">Confidencial</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
