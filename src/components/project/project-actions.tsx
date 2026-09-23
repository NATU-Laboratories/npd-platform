"use client";
import { Ban, Loader2, PauseCircle, PlayCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { cancelAction, pauseAction, resumeAction } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

type Kind = "pause" | "resume" | "cancel";
const CONF = {
  pause: { label: "Pausar", icon: PauseCircle, title: "Poner en pausa", field: "Motivo", required: true, variant: "secondary" as const, fn: pauseAction },
  resume: { label: "Reanudar", icon: PlayCircle, title: "Reanudar proyecto", field: "Comentario (opcional)", required: false, variant: "secondary" as const, fn: resumeAction },
  cancel: { label: "Cancelar proyecto", icon: Ban, title: "Cancelar proyecto", field: "Motivo", required: true, variant: "danger" as const, fn: cancelAction },
};

export function ProjectAction({ projectId, kind }: { projectId: string; kind: Kind }) {
  const c = CONF[kind];
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={kind === "cancel" ? "ghost" : "secondary"} className={kind === "cancel" ? "text-rose-700 hover:bg-rose-50" : undefined}>
          <c.icon /> {c.label}
        </Button>
      </DialogTrigger>
      <DialogContent title={c.title}>
        <Field label={c.field} required={c.required}>
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Volver
          </Button>
          <Button
            variant={kind === "cancel" ? "danger" : "default"}
            disabled={busy || (c.required && !text.trim())}
            onClick={async () => {
              setBusy(true);
              const r = await c.fn(projectId, text);
              setBusy(false);
              if (!r.ok) return toast.error(r.error);
              toast.success("Hecho");
              setOpen(false);
              router.refresh();
            }}
          >
            {busy && <Loader2 className="animate-spin" />} Confirmar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
