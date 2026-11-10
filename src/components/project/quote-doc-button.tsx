"use client";
import { FileText, Loader2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { regenerateQuoteDocAction } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";

/** Genera (o vuelve a generar) el Word de la última cotización en la carpeta del proyecto. */
export function QuoteDocButton({ projectId }: { projectId: string }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await regenerateQuoteDocAction(projectId);
        setBusy(false);
        if (r.ok) toast.success("Documento de la cotización guardado en «01 Cotización y valoración»");
        else toast.error(r.error);
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <FileText />} Generar documento de la cotización
    </Button>
  );
}
