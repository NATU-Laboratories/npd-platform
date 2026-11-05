"use client";
import { ExternalLink, FileText, Link2, Loader2, Trash2, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { addRepArtLinkAction, addRepCommentAction, createRepUploadAction, deleteRepFileAction, registerRepFileAction } from "@/app/actions/replenishments";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form";
import { uploadChunks } from "@/components/uploader";
import { REP_FILE_TAGS } from "@/lib/replenishment/config";
import { cn, formatBytes, formatDate } from "@/lib/utils";

export type RepFileRow = { id: number; name: string; size: number; tag: string; round: number; by: string; createdAt: string; mine: boolean; url?: string | null };

/** Archivos de la reposición (arte final por rondas, pruebas, cotizaciones…). */
export function RepFiles({ id, files, round, canUpload, defaultTag, canDeleteAll }: { id: string; files: RepFileRow[]; round: number; canUpload: boolean; defaultTag: string; canDeleteAll: boolean }) {
  const router = useRouter();
  // El arte final va como enlace (OneDrive / SharePoint); los archivos, para el resto
  const [tag, setTag] = React.useState(defaultTag === "arte_final" ? "prueba" : defaultTag);
  const [link, setLink] = React.useState("");
  const [linkName, setLinkName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  async function addLink() {
    setSaving(true);
    const res = await addRepArtLinkAction(id, link, linkName);
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    setLink("");
    setLinkName("");
    toast.success("Enlace al arte final añadido");
    router.refresh();
  }
  const [progress, setProgress] = React.useState<number | null>(null);
  const input = React.useRef<HTMLInputElement>(null);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    for (const file of Array.from(list)) {
      setProgress(0);
      const s = await createRepUploadAction(id, file.name, file.size);
      if (!s.ok) {
        toast.error(s.error);
        break;
      }
      try {
        const item = await uploadChunks(s.data!.uploadUrl, file, setProgress);
        const reg = await registerRepFileAction(id, item.id, tag);
        if (!reg.ok) toast.error(reg.error);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo subir el archivo");
      }
    }
    setProgress(null);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  async function remove(f: RepFileRow) {
    if (!window.confirm(`¿Eliminar «${f.name}»?`)) return;
    const res = await deleteRepFileAction(f.id);
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }

  const arts = files.filter((f) => f.tag === "arte_final");
  return (
    <div className="flex flex-col gap-3">
      {canUpload && (
        <div className="flex flex-col gap-2 rounded-lg bg-[#f4f5ef] p-3 ring-1 ring-natu-sage">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#56613f]">Enlace al arte final · ronda {round}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="url"
              inputMode="url"
              spellCheck={false}
              autoComplete="off"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://natuaromatic.sharepoint.com/…"
              aria-label="Enlace de OneDrive o SharePoint al arte final"
              className="h-8 min-w-56 flex-1 text-xs"
            />
            <Input value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder="Descripción (opcional)…" aria-label="Descripción del enlace" className="h-8 w-48 text-xs" maxLength={200} />
            <Button size="sm" onClick={addLink} disabled={saving || !link.trim()}>
              {saving ? <Loader2 className="animate-spin" /> : <Link2 aria-hidden />} Añadir enlace
            </Button>
          </div>
          <p className="text-[11px] text-[#56613f]">Pega el enlace de la carpeta o del archivo en OneDrive o SharePoint, con permiso para el equipo.</p>
        </div>
      )}
      {canUpload && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-slate-300 p-3">
          <Select value={tag} onChange={(e) => setTag(e.target.value)} className="h-8 w-56 text-xs" aria-label="Tipo de archivo">
            {Object.entries(REP_FILE_TAGS)
              .filter(([k]) => k !== "arte_final")
              .map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          <input ref={input} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          <Button variant="secondary" size="sm" onClick={() => input.current?.click()} disabled={progress !== null}>
            {progress !== null ? <Loader2 className="animate-spin" /> : <UploadCloud />}
            {progress !== null ? `Subiendo… ${progress}%` : "Subir archivo"}
          </Button>
          <span className="text-xs text-slate-500">Se guarda en la ronda {round}.</span>
          <span className="sr-only" aria-live="polite">
            {progress !== null ? `Subiendo archivo: ${progress} %` : ""}
          </span>
        </div>
      )}
      {!files.length && <p className="text-sm text-slate-500">Todavía no hay archivos.</p>}
      {arts.length > 0 && <FileList title="Arte final" files={arts} round={round} onDelete={remove} canDeleteAll={canDeleteAll} />}
      {files.length > arts.length && <FileList title="Otros archivos" files={files.filter((f) => f.tag !== "arte_final")} round={round} onDelete={remove} canDeleteAll={canDeleteAll} />}
    </div>
  );
}

function FileList({ title, files, round, onDelete, canDeleteAll }: { title: string; files: RepFileRow[]; round: number; onDelete: (f: RepFileRow) => void; canDeleteAll: boolean }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <ul className="flex flex-col gap-1">
        {files.map((f) => (
          <li key={f.id} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-sm", f.tag === "arte_final" && f.round === round ? "bg-[#eef0e6]" : "bg-slate-50")}>
            {f.url ? <ExternalLink className="size-4 shrink-0 text-brand-500" aria-hidden /> : <FileText className="size-4 shrink-0 text-slate-400" aria-hidden />}
            <a href={f.url ?? `/api/rep-files/${f.id}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-medium text-slate-800 hover:underline">
              {f.name}
            </a>
            <span className="hidden shrink-0 text-xs text-slate-500 sm:inline">
              {REP_FILE_TAGS[f.tag as keyof typeof REP_FILE_TAGS] ?? f.tag} · ronda {f.round} · {f.by} · {formatDate(f.createdAt)}{f.url ? " · enlace" : ` · ${formatBytes(f.size)}`}
            </span>
            {(f.mine || canDeleteAll) && (
              <button type="button" onClick={() => onDelete(f)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Eliminar ${f.name}`}>
                <Trash2 className="size-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Caja de comentarios de la reposición. */
export function RepCommentBox({ id }: { id: string }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    const res = await addRepCommentAction(id, body);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setBody("");
    router.refresh();
  }
  return (
    <div className="flex flex-col gap-2">
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escribe un comentario para el equipo…" maxLength={4000} className="min-h-16" aria-label="Comentario" />
      <Button size="sm" variant="secondary" onClick={send} disabled={busy || !body.trim()} className="self-end">
        {busy && <Loader2 className="animate-spin" />} Comentar
      </Button>
    </div>
  );
}
