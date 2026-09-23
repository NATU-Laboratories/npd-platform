"use client";
import { Loader2, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { addCommentAction } from "@/app/actions/comments";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";

type Mentionable = { kind: "user"; id: string; name: string } | { kind: "dept"; id: number; name: string };

/** Comentarios con menciones @usuario y @departamento (§7.2). */
export function CommentComposer({ projectId, users, departments }: { projectId: string; users: { id: string; name: string }[]; departments: { id: number; name: string }[] }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [mentions, setMentions] = React.useState<Mentionable[]>([]);
  const [query, setQuery] = React.useState<{ start: number; q: string } | null>(null);
  const [active, setActive] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const caret = React.useRef<number | null>(null);

  // Recolocar el cursor justo tras insertar una mención, antes de pintar
  React.useLayoutEffect(() => {
    if (caret.current == null || !ref.current) return;
    ref.current.focus();
    ref.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [body]);

  const all: Mentionable[] = React.useMemo(
    () => [...users.map((u) => ({ kind: "user" as const, id: u.id, name: u.name })), ...departments.map((d) => ({ kind: "dept" as const, id: d.id, name: d.name }))],
    [users, departments],
  );
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const matches = query ? all.filter((m) => norm(m.name).includes(norm(query.q))).slice(0, 8) : [];

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setBody(v);
    const pos = e.target.selectionStart;
    const before = v.slice(0, pos);
    const m = /(^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/.exec(before);
    if (m) {
      setQuery({ start: pos - m[2]!.length - 1, q: m[2]! });
      setActive(0);
    } else setQuery(null);
  };

  const pick = (m: Mentionable) => {
    if (!query) return;
    const el = ref.current!;
    const end = el.selectionStart;
    const next = `${body.slice(0, query.start)}@${m.name} ${body.slice(end)}`;
    setBody(next);
    setMentions((prev) => (prev.some((x) => x.kind === m.kind && x.id === m.id) ? prev : [...prev, m]));
    setQuery(null);
    caret.current = query.start + m.name.length + 2;
  };

  async function submit() {
    setBusy(true);
    const used = mentions.filter((m) => body.includes(`@${m.name}`));
    const r = await addCommentAction(projectId, body, {
      users: used.filter((m) => m.kind === "user").map((m) => m.id as string),
      departments: used.filter((m) => m.kind === "dept").map((m) => m.id as number),
    });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    setBody("");
    setMentions([]);
    router.refresh();
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        rows={3}
        value={body}
        onChange={onChange}
        placeholder="Escribe un comentario… usa @ para mencionar a personas o departamentos"
        aria-label="Nuevo comentario"
        onKeyDown={(e) => {
          if (query && matches.length) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(matches[active]!);
            } else if (e.key === "Escape") setQuery(null);
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) void submit();
        }}
      />
      {query && matches.length > 0 && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-56 w-72 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {matches.map((m, i) => (
            <li
              key={`${m.kind}-${m.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
              className={cn("flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm", i === active && "bg-brand-50")}
            >
              {m.name}
              <span className="text-xs text-slate-400">{m.kind === "user" ? "persona" : "departamento"}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex justify-end">
        <Button size="sm" onClick={submit} disabled={busy || !body.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Send />} Comentar
        </Button>
      </div>
    </div>
  );
}
