"use client";
import { Building2, Mail, Users } from "lucide-react";
import * as React from "react";
import type { RepEmail } from "@/lib/server/replenishments";
import { cn } from "@/lib/utils";

/** Vista previa de los emails que se van a enviar (destinatarios, asunto y cuerpo). */
export function EmailPreview({ emails }: { emails: RepEmail[] }) {
  const [sel, setSel] = React.useState(0);
  if (!emails.length) return <p className="text-sm text-slate-500">No se enviará ningún email.</p>;
  const e = emails[Math.min(sel, emails.length - 1)]!;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Emails que se enviarán">
        {emails.map((x, i) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={i === sel}
            onClick={() => setSel(i)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ring-1",
              i === sel ? "bg-natu-dark text-white ring-natu-dark" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
            )}
          >
            {x.audience === "supplier" ? <Building2 className="size-3.5" /> : <Users className="size-3.5" />}
            {x.audience === "supplier" ? `Proveedor · ${x.label}` : x.label}
            {!x.to.length && <span className="text-amber-500">· sin email</span>}
          </button>
        ))}
      </div>
      <div className="rounded-lg border border-slate-200 text-xs">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-b border-slate-100 bg-slate-50 px-3 py-2">
          <dt className="text-slate-500">Para</dt>
          <dd className={cn("break-all", !e.to.length && "text-amber-700")}>
            {e.to.length
              ? e.to.join(", ")
              : e.audience === "supplier"
                ? "Este proveedor no tiene email: añádelo para poder enviárselo."
                : "Nadie: el departamento no tiene miembros ni emails de aviso (Backoffice → Departamentos)."}
          </dd>
          {e.replyTo?.length ? (
            <>
              <dt className="text-slate-500">Responder a</dt>
              <dd className="break-all">{e.replyTo.join(", ")}</dd>
            </>
          ) : null}
          <dt className="text-slate-500">Asunto</dt>
          <dd className="font-medium text-slate-800">
            <Mail className="mr-1 inline size-3.5 text-slate-400" />
            {e.subject}
          </dd>
        </dl>
        <iframe title={`Vista previa: ${e.subject}`} srcDoc={e.html} sandbox="" className="h-[420px] w-full rounded-b-lg bg-white" />
      </div>
    </div>
  );
}
