"use client";
import { FileText, ImageIcon, Loader2, Trash2, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { createUploadAction, deleteFileAction, registerFileAction, updateFileTagAction } from "@/app/actions/files";
import { FILE_TAGS } from "@/lib/labels";
import { cn, formatBytes } from "@/lib/utils";

export type UploadedFile = { id: number; name: string; size: number; mime: string | null; tag: string | null };

// Graph exige trozos múltiplos de 320 KiB (y < 60 MiB)
const CHUNK = 320 * 1024 * 16; // 5 MiB

async function uploadChunks(uploadUrl: string, file: File, onProgress: (pct: number) => void) {
  let start = 0;
  let last: Response | null = null;
  // Si el archivo está vacío, Graph requiere al menos un PUT
  do {
    const end = Math.min(start + CHUNK, file.size);
    const chunk = file.slice(start, end);
    last = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Range": `bytes ${start}-${Math.max(end - 1, 0)}/${file.size}`,
        ...(uploadUrl.startsWith("/") ? { "x-file-type": file.type || "application/octet-stream" } : {}),
      },
      body: chunk,
    });
    if (!last.ok) throw new Error(`Error ${last.status} subiendo ${file.name}`);
    start = end;
    onProgress(file.size ? Math.round((start / file.size) * 100) : 100);
  } while (start < file.size);
  return (await last.json()) as { id: string };
}

export function Uploader({
  projectId,
  phase = 0,
  initial = [],
  maxMb,
  defaultTag = "otro",
  showTags = true,
  canDelete = true,
  onChange,
  compact,
  refreshOnUpload,
}: {
  projectId: string;
  phase?: number;
  initial?: UploadedFile[];
  maxMb: number;
  defaultTag?: string;
  showTags?: boolean;
  canDelete?: boolean;
  onChange?: (files: UploadedFile[]) => void;
  compact?: boolean;
  /** Refrescar los datos del servidor tras cada subida (ficha de proyecto). */
  refreshOnUpload?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = React.useState<UploadedFile[]>(initial);
  const [pending, setPending] = React.useState<{ key: string; name: string; pct: number }[]>([]);
  const [drag, setDrag] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const update = (next: UploadedFile[]) => {
    setItems(next);
    onChange?.(next);
  };
  const itemsRef = React.useRef(items);
  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  async function handleFiles(list: FileList | File[]) {
    for (const file of Array.from(list)) {
      if (file.size > maxMb * 1024 * 1024) {
        toast.error(`${file.name}: supera el límite de ${maxMb} MB`);
        continue;
      }
      const key = `${file.name}-${Date.now()}-${Math.random()}`;
      setPending((p) => [...p, { key, name: file.name, pct: 0 }]);
      try {
        const session = await createUploadAction(projectId, file.name, file.size, phase);
        if (!session.ok) throw new Error(session.error);
        const item = await uploadChunks(session.data!.uploadUrl, file, (pct) =>
          setPending((p) => p.map((x) => (x.key === key ? { ...x, pct } : x))),
        );
        const reg = await registerFileAction(projectId, item.id, defaultTag, phase);
        if (!reg.ok) throw new Error(reg.error);
        const next = [...itemsRef.current, { ...reg.data!, tag: defaultTag }];
        itemsRef.current = next;
        update(next);
        if (refreshOnUpload) router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `No se pudo subir ${file.name}`);
      } finally {
        setPending((p) => p.filter((x) => x.key !== key));
      }
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-center transition-colors",
          compact ? "px-3 py-3" : "px-4 py-8",
          drag ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50 hover:border-brand-400",
        )}
      >
        <UploadCloud className="size-6 text-brand-600" />
        <p className="text-sm text-slate-700">
          <span className="font-medium text-brand-700">Pulsa para elegir</span> o arrastra archivos aquí
        </p>
        {!compact && <p className="text-xs text-slate-500">Imágenes, PDF, Office, zip · máx. {maxMb} MB por archivo</p>}
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {(items.length > 0 || pending.length > 0) && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {items.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              {f.mime?.startsWith("image/") ? <ImageIcon className="size-4 text-slate-400" /> : <FileText className="size-4 text-slate-400" />}
              <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-slate-800 hover:underline">
                {f.name}
              </a>
              <span className="text-xs text-slate-400">{formatBytes(f.size)}</span>
              {showTags && (
                <select
                  aria-label={`Etiqueta de ${f.name}`}
                  value={f.tag ?? "otro"}
                  onChange={async (e) => {
                    const tag = e.target.value;
                    update(items.map((x) => (x.id === f.id ? { ...x, tag } : x)));
                    const r = await updateFileTagAction(f.id, tag);
                    if (!r.ok) toast.error(r.error);
                  }}
                  className="h-7 rounded border border-slate-200 bg-white px-1 text-xs"
                >
                  {Object.entries(FILE_TAGS)
                    .filter(([k]) => k !== "evidencia_cliente")
                    .map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                </select>
              )}
              {canDelete && (
                <button
                  type="button"
                  aria-label={`Eliminar ${f.name}`}
                  onClick={async () => {
                    const r = await deleteFileAction(f.id);
                    if (r.ok) update(items.filter((x) => x.id !== f.id));
                    else toast.error(r.error);
                  }}
                  className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.key} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="w-24 overflow-hidden rounded-full bg-slate-100">
                <span className="block h-1.5 bg-brand-500 transition-all" style={{ width: `${p.pct}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
