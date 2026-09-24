"use client";
import { CheckCircle2, Loader2, RotateCcw, Slash } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { setSheetStatusAction } from "@/app/actions/sheet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import type { SheetStatus } from "@/lib/sheet/sections";

/** Acciones de estado de un apartado: terminar, no aplica, reabrir. */
export function SectionStatusActions({
  projectId,
  sectionKey,
  title,
  status,
  missing,
}: {
  projectId: string;
  sectionKey: string;
  title: string;
  status: SheetStatus;
  missing: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<SheetStatus | null>(null);
  const [naOpen, setNaOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");

  async function change(next: SheetStatus, note?: string) {
    setBusy(next);
    const res = await setSheetStatusAction(projectId, sectionKey, next, note);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(next === "done" ? `«${title}» marcado como terminado` : next === "na" ? "Marcado como no aplicable" : "Apartado reabierto");
    setNaOpen(false);
    router.refresh();
  }

  if (status !== "pending") {
    return (
      <Button variant="ghost" size="sm" onClick={() => change("pending")} disabled={!!busy}>
        {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reabrir
      </Button>
    );
  }
  return (
    <>
      <Dialog open={naOpen} onOpenChange={setNaOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm">
            <Slash /> No aplica
          </Button>
        </DialogTrigger>
        <DialogContent title={`«${title}» no aplica`} description="Quedará registrado quién lo marcó y por qué.">
          <Field label="Motivo" required>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="p. ej. el cliente aporta su propio envase" />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNaOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => change("na", reason)} disabled={!reason.trim() || !!busy}>
              {busy === "na" && <Loader2 className="animate-spin" />} Confirmar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Button
        size="sm"
        onClick={() => change("done")}
        disabled={missing > 0 || !!busy}
        title={missing > 0 ? `Faltan ${missing} requisito${missing === 1 ? "" : "s"} obligatorio${missing === 1 ? "" : "s"}` : undefined}
      >
        {busy === "done" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Marcar como terminado
      </Button>
    </>
  );
}
