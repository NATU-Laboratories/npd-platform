"use client";
import { Loader2, MessageCircle, RotateCcw, Send, Sparkles, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";

type Turn = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "npd-assistant";
const SUGGESTIONS = ["¿Qué tengo pendiente?", "¿Qué proyectos están en riesgo?", "¿Cómo creo una nueva solicitud?", "¿Qué es P2 y quién lo registra?"];

/** Markdown mínimo: **negrita**, [texto](/ruta) y listas con «- ». */
function Rich({ text }: { text: string }) {
  const inline = (line: string, key: string) => {
    const parts: React.ReactNode[] = [];
    const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(line))) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      if (m[1]) parts.push(<strong key={`${key}-${i++}`}>{m[1]}</strong>);
      else if (m[3]?.startsWith("/"))
        parts.push(
          <Link key={`${key}-${i++}`} href={m[3]} className="font-medium text-brand-500 underline underline-offset-2">
            {m[2]}
          </Link>,
        );
      else parts.push(m[2]);
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return parts;
  };
  const lines = text.split("\n");
  return (
    <div className="flex flex-col gap-1">
      {lines.map((l, idx) =>
        /^\s*[-*•]\s+/.test(l) ? (
          <p key={idx} className="flex gap-1.5 pl-1">
            <span aria-hidden>•</span>
            <span>{inline(l.replace(/^\s*[-*•]\s+/, ""), String(idx))}</span>
          </p>
        ) : l.trim() ? (
          <p key={idx}>{inline(l.replace(/^#+\s*/, ""), String(idx))}</p>
        ) : null,
      )}
    </div>
  );
}

/** Asistente virtual flotante (consulta de proyectos y ayuda de uso). */
export function AssistantWidget({ firstName }: { firstName: string }) {
  const [open, setOpen] = React.useState(false);
  // Conversación de la pestaña actual (se pierde al cerrar el navegador). El panel arranca
  // cerrado, así que el valor guardado no cambia lo que se pinta en el servidor.
  const [turns, setTurns] = React.useState<Turn[]>(() => {
    try {
      return typeof window === "undefined" ? [] : ((JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]") as Turn[]) ?? []);
    } catch {
      return [];
    }
  });
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-30)));
    } catch {}
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);
  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: q }];
    setTurns(next);
    setInput("");
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next }) });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !data.text) {
        setError(data.error ?? "No he podido responder. Inténtalo de nuevo.");
        setTurns(turns); // se puede reenviar la pregunta
        setInput(q);
      } else setTurns([...next, { role: "assistant", content: data.text }]);
    } catch {
      setError("Sin conexión. Inténtalo de nuevo.");
      setTurns(turns);
      setInput(q);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-natu-dark px-4 py-3 text-sm font-semibold text-white shadow-lg ring-2 ring-natu-sage hover:bg-brand-700"
          aria-label="Abrir el asistente virtual"
        >
          <MessageCircle className="size-5" aria-hidden /> <span className="hidden sm:inline">Asistente</span>
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-label="Asistente virtual"
          className="fixed inset-x-2 bottom-2 z-50 flex max-h-[80dvh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[600px] sm:w-[400px]"
        >
          <header className="flex items-center gap-2 bg-natu-dark px-4 py-3 text-white">
            <span className="flex size-8 items-center justify-center rounded-full bg-natu-sage text-natu-dark">
              <Sparkles className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Asistente NPD</p>
              <p className="text-[11px] text-white/70">Proyectos, pendientes y uso de la plataforma</p>
            </div>
            {turns.length > 0 && (
              <button type="button" onClick={() => setTurns([])} className="rounded p-1.5 text-white/80 hover:bg-white/10" title="Nueva conversación" aria-label="Nueva conversación">
                <RotateCcw className="size-4" />
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} className="rounded p-1.5 text-white/80 hover:bg-white/10" aria-label="Cerrar el asistente">
              <X className="size-4" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto bg-slate-50 px-3 py-3 text-sm" aria-live="polite">
            {turns.length === 0 && (
              <div className="flex flex-col gap-3 p-1">
                <p className="text-slate-700">
                  ¡Hola, {firstName}! Soy tu asistente. Puedo contarte cómo va cualquier proyecto que puedas ver, qué tienes pendiente o cómo se hace algo en la plataforma.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="rounded-full bg-white px-3 py-1.5 text-xs text-slate-700 ring-1 ring-slate-200 hover:bg-brand-50 hover:ring-brand-200">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2.5">
              {turns.map((t, i) => (
                <div
                  key={i}
                  className={cn(
                    "max-w-[88%] rounded-2xl px-3 py-2 leading-relaxed",
                    t.role === "user" ? "self-end rounded-br-sm bg-natu-dark text-white" : "self-start rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200",
                  )}
                >
                  {t.role === "assistant" ? <Rich text={t.content} /> : <p className="whitespace-pre-wrap">{t.content}</p>}
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 self-start rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-slate-500 ring-1 ring-slate-200">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Pensando…
                </div>
              )}
              {error && <p className="self-center rounded-md bg-rose-50 px-3 py-1.5 text-xs text-rose-700">{error}</p>}
              <div ref={endRef} />
            </div>
          </div>

          <form
            className="flex items-end gap-2 border-t border-slate-200 bg-white p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder="Pregunta lo que necesites…"
              aria-label="Tu pregunta"
              maxLength={4000}
              className="max-h-32 min-h-9 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-natu-dark text-white hover:bg-brand-700 disabled:opacity-40"
              aria-label="Enviar"
            >
              <Send className="size-4" />
            </button>
          </form>
          <p className="bg-white px-3 pb-2 text-[10px] text-slate-400">Asistente con IA: puede equivocarse. Solo consulta, no hace cambios.</p>
        </section>
      )}
    </>
  );
}
