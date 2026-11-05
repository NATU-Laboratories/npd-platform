"use client";
import { Check, Loader2, MessageCircle, Mic, RotateCcw, Send, Sparkles, Square, Volume2, VolumeX, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { cn } from "@/lib/utils";

type ActionCard = { id: string; title: string; lines: [string, string][]; status?: "pending" | "done" | "cancelled" | "failed"; result?: string };
type Turn = { role: "user" | "assistant"; content: string; actions?: ActionCard[] };
type Notice = { id: number; title: string; body: string; link: string | null; urgent: boolean; from: string | null };

const noticeMessage = (list: Notice[]) =>
  list
    .map((n) => `📬 **${n.title}**${n.link ? ` · [abrir](${n.link})` : ""}\n«${n.body}»`)
    .join("\n\n");

const STORAGE_KEY = "npd-assistant";
const SUGGESTIONS = ["¿Qué tengo pendiente?", "¿Qué proyectos están en riesgo?", "¿Hay reposiciones en marcha?", "¿Cómo creo una nueva solicitud?"];

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
        ) : /^\s*>\s?/.test(l) ? (
          <p key={idx} className="border-l-2 border-natu-sage pl-2 italic text-slate-600">
            {inline(l.replace(/^\s*>\s?/, ""), String(idx))}
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
  const [notices, setNotices] = React.useState<Notice[]>([]);
  // Página en la que está la persona: si es un proyecto o una reposición, Alexia sabe de cuál se habla
  const pathname = usePathname();
  const endRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const voice = useVoice();

  React.useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-30)));
    } catch {}
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);
  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Avisos que otras personas le han enviado vía Alexia: con el chat abierto, Alexia los cuenta
  // y quedan leídos; con el chat cerrado, se ven como contador en el botón.
  const openRef = React.useRef(open);
  const deliver = React.useCallback((list: Notice[]) => {
    if (!list.length) return;
    setTurns((t) => [...t, { role: "assistant", content: noticeMessage(list) }]);
    void fetch("/api/assistant/notices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: list.map((n) => n.id) }) });
  }, []);
  React.useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/assistant/notices", { cache: "no-store" });
        const data = (await res.json()) as { notices?: Notice[] };
        if (!alive || !res.ok) return;
        if (openRef.current) deliver(data.notices ?? []);
        else setNotices(data.notices ?? []);
      } catch {}
    };
    void load();
    const t = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [deliver]);

  function openPanel() {
    openRef.current = true;
    setOpen(true);
    deliver(notices);
    setNotices([]);
  }
  function closePanel() {
    openRef.current = false;
    setOpen(false);
  }

  async function decide(turnIdx: number, actionId: string, decision: "confirm" | "cancel") {
    const patch = (p: Partial<ActionCard>) =>
      setTurns((list) => list.map((t, i) => (i === turnIdx ? { ...t, actions: t.actions?.map((a) => (a.id === actionId ? { ...a, ...p } : a)) } : t)));
    patch({ status: "pending", result: decision === "confirm" ? "Enviando…" : "Cancelando…" });
    try {
      const res = await fetch(`/api/assistant/actions/${actionId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
      const msg = data.message ?? data.error ?? "No se ha podido completar.";
      patch({ status: data.ok ? (decision === "confirm" ? "done" : "cancelled") : "failed", result: msg });
      // Queda en la conversación para que Alexia sepa qué ha pasado
      setTurns((list) => [...list, { role: "assistant", content: msg }]);
    } catch {
      patch({ status: undefined, result: "Sin conexión. Inténtalo de nuevo." });
    }
  }

  async function send(text: string, spoken = false) {
    const q = text.trim();
    if (!q || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: q }];
    setTurns(next);
    setInput("");
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })).slice(-40), page: pathname }),
      });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string; actions?: ActionCard[] };
      if (!res.ok || !data.text) {
        setError(data.error ?? "No he podido responder. Inténtalo de nuevo.");
        setTurns(turns); // se puede reenviar la pregunta
        setInput(q);
      } else {
        const idx = next.length;
        setTurns([...next, { role: "assistant", content: data.text, actions: data.actions?.length ? data.actions : undefined }]);
        // Si le ha hablado o tiene el modo voz activado, Alexia contesta también en voz alta
        if (spoken || voice.mode) void voice.play(idx, data.text);
      }
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
          onClick={openPanel}
          className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full bg-natu-dark p-3 text-sm font-semibold text-white shadow-lg ring-2 ring-natu-sage hover:bg-brand-700 sm:bottom-5 sm:right-5 sm:px-3.5 sm:py-2.5"
          aria-label="Abrir Alexia, el asistente virtual"
        >
          <MessageCircle className="size-5" aria-hidden /> <span className="hidden sm:inline">Alexia</span>
          {notices.length > 0 && (
            <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-natu-salmon text-[11px] font-bold text-natu-dark ring-2 ring-white" aria-label={`${notices.length} avisos nuevos`}>
              {notices.length}
            </span>
          )}
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-label="Alexia, asistente virtual"
          className="fixed inset-x-2 bottom-2 z-50 flex max-h-[80dvh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[600px] sm:w-[400px]"
        >
          <header className="flex items-center gap-2 bg-natu-dark px-4 py-3 text-white">
            <span className="flex size-8 items-center justify-center rounded-full bg-natu-sage text-natu-dark">
              <Sparkles className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold tracking-wide">ALEXIA</p>
              <p className="text-[11px] text-white/70">Asistente virtual</p>
            </div>
            {voice.supported && (
              <button
                type="button"
                onClick={voice.toggleMode}
                aria-pressed={voice.mode}
                className={cn("rounded p-1.5 hover:bg-white/10", voice.mode ? "text-natu-sage" : "text-white/80")}
                title={voice.mode ? "Modo voz activado: Alexia lee sus respuestas" : "Activar modo voz: Alexia lee sus respuestas en voz alta"}
                aria-label={voice.mode ? "Desactivar el modo voz" : "Activar el modo voz"}
              >
                {voice.mode ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              </button>
            )}
            {turns.length > 0 && (
              <button type="button" onClick={() => setTurns([])} className="rounded p-1.5 text-white/80 hover:bg-white/10" title="Nueva conversación" aria-label="Nueva conversación">
                <RotateCcw className="size-4" />
              </button>
            )}
            <button type="button" onClick={closePanel} className="rounded p-1.5 text-white/80 hover:bg-white/10" aria-label="Cerrar Alexia">
              <X className="size-4" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto bg-slate-50 px-3 py-3 text-sm" aria-live="polite">
            {turns.length === 0 && (
              <div className="flex flex-col gap-3 p-1">
                <p className="text-slate-700">
                  ¡Hola, {firstName}! Soy Alexia 🌿 Pregúntame cómo va cualquier proyecto o reposición, qué tienes pendiente o cómo se hace algo en la plataforma. Yo me encargo de rebuscar.
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
                  {t.role === "assistant" && voice.supported && (
                    <button
                      type="button"
                      onClick={() => (voice.playing === i ? voice.stop() : voice.play(i, t.content))}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700"
                      aria-label={voice.playing === i ? "Parar la lectura" : "Escuchar esta respuesta"}
                    >
                      {voice.loading === i ? <Loader2 className="size-3 animate-spin" aria-hidden /> : voice.playing === i ? <Square className="size-3" aria-hidden /> : <Volume2 className="size-3" aria-hidden />}
                      {voice.playing === i ? "Parar" : "Escuchar"}
                    </button>
                  )}
                  {t.actions?.map((a) => (
                    <div key={a.id} className="mt-2 rounded-xl bg-[#f4f5ef] p-3 ring-1 ring-natu-sage">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#56613f]">{a.status === "done" ? "Hecho" : a.status === "failed" ? "No se ha podido hacer" : a.status === "cancelled" ? "Cancelado" : "Pendiente de tu confirmación"}</p>
                      <p className="mt-0.5 font-semibold text-slate-900">{a.title}</p>
                      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
                        {a.lines.map(([k, v]) => (
                          <React.Fragment key={k}>
                            <dt className="text-slate-500">{k}</dt>
                            <dd className="whitespace-pre-line text-slate-800">{v}</dd>
                          </React.Fragment>
                        ))}
                      </dl>
                      {a.status === "done" || a.status === "cancelled" || a.status === "failed" ? (
                        <p className={cn("mt-2 flex items-center gap-1 text-xs font-medium", a.status === "done" ? "text-[#56613f]" : a.status === "failed" ? "text-rose-700" : "text-slate-500")}>
                          {a.status === "done" && <Check className="size-3.5" aria-hidden />}
                          {a.result ?? (a.status === "done" ? "Hecho" : a.status === "cancelled" ? "Cancelado" : "No se ha podido hacer")}
                        </p>
                      ) : (
                        <div className="mt-2.5 flex gap-2">
                          <button
                            type="button"
                            disabled={a.status === "pending"}
                            onClick={() => decide(i, a.id, "confirm")}
                            className="inline-flex items-center gap-1 rounded-md bg-natu-dark px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                          >
                            {a.status === "pending" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />} Confirmar
                          </button>
                          <button
                            type="button"
                            disabled={a.status === "pending"}
                            onClick={() => decide(i, a.id, "cancel")}
                            className="rounded-md px-3 py-1.5 text-xs text-slate-600 ring-1 ring-slate-300 hover:bg-white disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
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

          {voice.recording && (
            <div className="flex items-center gap-2 border-t border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="status">
              <span className="size-2.5 animate-pulse rounded-full bg-rose-500" aria-hidden />
              Te escucho… {formatSecs(voice.seconds)} · pulsa ■ para enviar
              <button type="button" onClick={voice.cancel} className="ml-auto rounded px-2 py-0.5 text-rose-700 hover:bg-rose-100">
                Cancelar
              </button>
            </div>
          )}
          {voice.transcribing && (
            <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Pasando tu audio a texto…
            </div>
          )}
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
            {voice.canRecord && !input.trim() ? (
              <button
                type="button"
                disabled={busy || voice.transcribing}
                onClick={async () => {
                  if (!voice.recording) return voice.start((m) => setError(m));
                  setError(null);
                  const text = await voice.finish((m) => setError(m));
                  if (text) void send(text, true);
                }}
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg text-white disabled:opacity-40",
                  voice.recording ? "bg-rose-600 hover:bg-rose-700" : "bg-natu-dark hover:bg-brand-700",
                )}
                aria-label={voice.recording ? "Terminar y enviar el audio" : "Hablar con Alexia"}
                title={voice.recording ? "Terminar y enviar" : "Pulsa para hablar"}
              >
                {voice.recording ? <Square className="size-4" /> : <Mic className="size-4" />}
              </button>
            ) : (
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-natu-dark text-white hover:bg-brand-700 disabled:opacity-40"
              aria-label="Enviar"
            >
              <Send className="size-4" />
            </button>
            )}
          </form>
          <p className="bg-white px-3 pb-2 text-[10px] text-slate-400">Asistente con IA: puede equivocarse. Los emails a proveedores siempre se confirman antes.</p>
        </section>
      )}
    </>
  );
}

const formatSecs = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
const MAX_SECONDS = 120;
const VOICE_KEY = "npd-assistant-voice";

/**
 * Voz de Alexia en el navegador: grabar una nota de voz (se transcribe en el servidor) y
 * reproducir sus respuestas (audio generado en el servidor; si falla, la voz del navegador).
 */
function useVoice() {
  const [canRecord, setCanRecord] = React.useState(false);
  const [supported, setSupported] = React.useState(false);
  const [mode, setMode] = React.useState(false);
  const [recording, setRecording] = React.useState(false);
  const [transcribing, setTranscribing] = React.useState(false);
  const [seconds, setSeconds] = React.useState(0);
  const [playing, setPlaying] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState<number | null>(null);
  const rec = React.useRef<{ mr: MediaRecorder; chunks: Blob[]; stream: MediaStream; timer: ReturnType<typeof setInterval>; cancelled: boolean } | null>(null);
  const audio = React.useRef<HTMLAudioElement | null>(null);

  React.useEffect(() => {
    // Solo en el navegador (evita diferencias con el HTML del servidor)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- capacidades del navegador
    setCanRecord(typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
    setSupported(typeof window !== "undefined" && typeof Audio !== "undefined");
    try {
      setMode(localStorage.getItem(VOICE_KEY) === "1");
    } catch {}
  }, []);

  const stop = React.useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    setPlaying(null);
  }, []);

  const play = React.useCallback(
    async (idx: number, text: string) => {
      stop();
      setLoading(idx);
      try {
        const res = await fetch("/api/assistant/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
        if (!res.ok) throw new Error("tts");
        const url = URL.createObjectURL(await res.blob());
        const a = new Audio(url);
        audio.current = a;
        a.onended = () => {
          URL.revokeObjectURL(url);
          setPlaying((p) => (p === idx ? null : p));
        };
        setPlaying(idx);
        await a.play();
      } catch {
        // Plan B: la voz del propio navegador
        if (typeof speechSynthesis !== "undefined") {
          const u = new SpeechSynthesisUtterance(text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`#>]/g, ""));
          u.lang = "es-ES";
          u.onend = () => setPlaying((p) => (p === idx ? null : p));
          setPlaying(idx);
          speechSynthesis.speak(u);
        }
      } finally {
        setLoading(null);
      }
    },
    [stop],
  );

  const cleanup = () => {
    const r = rec.current;
    if (!r) return;
    clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
    setRecording(false);
    setSeconds(0);
  };

  async function start(onError: (m: string) => void) {
    stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t));
      const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const timer = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS && mr.state === "recording") mr.stop();
          return s + 1;
        });
      }, 1000);
      rec.current = { mr, chunks, stream, timer, cancelled: false };
      mr.start();
      setRecording(true);
    } catch {
      onError("No puedo acceder al micrófono. Revisa el permiso del navegador.");
    }
  }

  /** Termina la grabación y devuelve el texto transcrito. */
  async function finish(onError: (m: string) => void): Promise<string | null> {
    const r = rec.current;
    if (!r) return null;
    // Si ya se paró (límite de tiempo), no hay que esperar al evento
    if (r.mr.state === "recording") {
      const done = new Promise<void>((resolve) => (r.mr.onstop = () => resolve()));
      r.mr.stop();
      await done;
    }
    const blob = new Blob(r.chunks, { type: r.mr.mimeType || "audio/webm" });
    cleanup();
    if (r.cancelled || blob.size < 1000) return null;
    setTranscribing(true);
    try {
      const fd = new FormData();
      const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      fd.append("audio", blob, `nota.${ext}`);
      const res = await fetch("/api/assistant/transcribe", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !data.text) {
        onError(data.error ?? "No he podido entender el audio.");
        return null;
      }
      return data.text;
    } catch {
      onError("Sin conexión. Inténtalo de nuevo.");
      return null;
    } finally {
      setTranscribing(false);
    }
  }

  function cancel() {
    if (rec.current) {
      rec.current.cancelled = true;
      if (rec.current.mr.state === "recording") rec.current.mr.stop();
    }
    cleanup();
  }

  function toggleMode() {
    setMode((m) => {
      try {
        localStorage.setItem(VOICE_KEY, m ? "0" : "1");
      } catch {}
      if (m) stop();
      return !m;
    });
  }

  return { canRecord, supported, mode, toggleMode, recording, transcribing, seconds, start, finish, cancel, play, stop, playing, loading };
}
