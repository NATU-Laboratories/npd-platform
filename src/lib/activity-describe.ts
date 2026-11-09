/**
 * Texto de cada movimiento del historial de un proyecto (página del proyecto e historial
 * que se guarda en SharePoint). Módulo puro.
 */
import { FIELD_BY_KEY } from "@/lib/brief/fields";
import { ACTION_LABEL, GATE_LABEL, PHASES } from "@/lib/labels";

export type ActivityGroup = "comentarios" | "decisiones" | "info" | "ediciones" | "ficha" | "archivos" | "otros";
export type ActivityText = { group: ActivityGroup; text: string; detail?: string | null; changes?: { field: string; from: string; to: string }[] };

export function fmt(v: unknown): string {
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return v.map(fmt).join(", ");
  if (typeof v === "object")
    return Object.values(v as object)
      .filter(Boolean)
      .map(fmt)
      .join(" / ");
  if (typeof v === "boolean") return v ? "Sí" : "No";
  return String(v);
}

export function fieldLabel(path: string) {
  const direct = FIELD_BY_KEY[path];
  if (direct) return direct.label;
  const parts = path.split(".");
  for (let i = parts.length - 1; i > 0; i--) {
    const f = FIELD_BY_KEY[parts.slice(0, i).join(".")];
    if (f) return `${f.label} (${parts.slice(i).join(".")})`;
  }
  return path;
}

export function describeActivity(
  a: { action: string; diff: unknown },
  ctx: { departments: { id: number; name: string }[]; rejectionReasons: Record<string, string> },
): ActivityText {
  const diff = (a.diff ?? {}) as Record<string, unknown>;
  const departments = ctx.departments;
  const c = { rejection_reason: ctx.rejectionReasons };
  switch (a.action) {
    case "comment.created":
      return {
        group: "comentarios",
        text: "comentó",
        detail: String(diff.body ?? ""),
      };
    case "gate.approved": {
      if (diff.gate === "G2") {
        const ppd = diff.prepayment as { status?: string; responsible?: string; note?: string } | null | undefined;
        const ppText =
          ppd?.status === "received"
            ? "Anticipo del 30 % recibido."
            : ppd?.status === "waived"
              ? `Inicio SIN anticipo bajo la responsabilidad de ${ppd.responsible}.`
              : null;
        return {
          group: "decisiones",
          text: "registró la aprobación del presupuesto por el cliente (P2)",
          detail: [ppText, ppd?.note, diff.comment as string].filter(Boolean).join("\n") || null,
        };
      }
      const names = (diff.departmentIds as number[] | undefined)?.map((x) => departments.find((dd) => dd.id === x)?.name).filter(Boolean);
      return {
        group: "decisiones",
        text: `aprobó la solicitud (P1) · departamentos: ${names?.join(", ") ?? "—"}`,
        detail: (diff.comment as string) || null,
      };
    }
    case "gate.recycled":
      return {
        group: "decisiones",
        text: "registró que el cliente pide cambios · vuelve a Cotización",
        detail: (diff.reason as string) || null,
      };
    case "quote.sent":
      return {
        group: "decisiones",
        text: `envió la cotización al comercial${diff.amount != null ? ` (${Number(diff.amount).toLocaleString("es-ES", { style: "currency", currency: "EUR" })})` : ""}`,
        detail: (diff.comment as string) || null,
      };
    case "phase.advanced":
      return {
        group: "decisiones",
        text: `avanzó a la fase «${PHASES[Number(diff.to)]?.name ?? diff.to}»`,
        detail: (diff.comment as string) || null,
      };
    case "project.in_production":
      return {
        group: "decisiones",
        text: "pasó el proyecto a producción",
        detail: (diff.comment as string) || null,
      };
    case "prepayment.received":
      return {
        group: "decisiones",
        text: "registró el anticipo del 30 %",
        detail: (diff.note as string) || null,
      };
    case "gate.rejected": {
      const reason = c.rejection_reason?.[String(diff.reasonCode)] ?? String(diff.reasonCode ?? "");
      return {
        group: "decisiones",
        text: `rechazó el proyecto en ${GATE_LABEL[String(diff.gate ?? "G1")] ?? diff.gate}`,
        detail: [reason, diff.reasonText].filter(Boolean).join(" — "),
      };
    }
    case "gate.paused":
    case "project.cancelled":
    case "project.resumed":
      return {
        group: "decisiones",
        text: ACTION_LABEL[a.action]!,
        detail: (diff.reason as string) || (diff.comment as string) || null,
      };
    case "gate.info_requested": {
      const fields = (diff.fields as string[] | undefined)?.map(fieldLabel) ?? [];
      return {
        group: "info",
        text: "pidió más información",
        detail: `${diff.message ?? ""}${fields.length ? `\nCampos: ${fields.join(", ")}` : ""}`,
      };
    }
    case "info.answered":
      return {
        group: "info",
        text: "respondió a la petición de información",
        detail: String(diff.answer ?? ""),
      };
    case "project.edited":
      return {
        group: "ediciones",
        text: "editó el brief",
        changes: Object.entries(diff as Record<string, { from: unknown; to: unknown }>).map(([k, v]) => ({
          field: fieldLabel(k),
          from: fmt(v?.from),
          to: fmt(v?.to),
        })),
      };
    case "sheet.updated": {
      const fields = (diff.fields as string[] | undefined) ?? [];
      return {
        group: "ficha",
        text: `actualizó «${diff.title ?? diff.section}» en la ficha técnica`,
        detail:
          [fields.length ? `Campos: ${fields.join(", ")}` : null, diff.reopened ? "Vuelve a pendiente: falta información obligatoria." : null]
            .filter(Boolean)
            .join("\n") || null,
      };
    }
    case "dept.advanced":
    case "dept.completed":
    case "dept.returned":
      return {
        group: "ficha",
        text:
          a.action === "dept.returned"
            ? `devolvió ${diff.department} a «${diff.to}» (ronda ${diff.round})`
            : a.action === "dept.completed"
              ? `completó ${diff.department} («${diff.to}»)`
              : `pasó ${diff.department} de «${diff.from}» a «${diff.to}»`,
        detail: (diff.comment as string) || null,
      };
    case "sheet.done":
      return {
        group: "ficha",
        text: `marcó como terminado «${diff.title ?? diff.section}»`,
      };
    case "sheet.na":
      return {
        group: "ficha",
        text: `marcó «${diff.title ?? diff.section}» como no aplicable`,
        detail: (diff.note as string) || null,
      };
    case "sheet.reopened":
      return {
        group: "ficha",
        text: `reabrió «${diff.title ?? diff.section}»`,
      };
    case "file.uploaded":
    case "file.deleted":
      return {
        group: "archivos",
        text: `${ACTION_LABEL[a.action]}: ${diff.name ?? ""}`,
      };
    case "project.submitted":
      return {
        group: "decisiones",
        text: `envió la solicitud (${diff.code ?? ""})${diff.registeredBy ? ` · registrada por ${diff.registeredBy}` : ""}`,
      };
    default:
      return {
        group: "otros",
        text: ACTION_LABEL[a.action] ?? a.action,
      };
  }
}
