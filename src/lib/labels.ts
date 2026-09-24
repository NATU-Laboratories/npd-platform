import type { ProjectStatus } from "@/db/schema";

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "Borrador",
  submitted: "Solicitado",
  info_requested: "Pendiente de info",
  in_progress: "En curso",
  paused: "En pausa",
  in_production: "En producción",
  rejected: "Rechazado",
  cancelled: "Cancelado",
};

export const STATUS_COLOR: Record<ProjectStatus, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  submitted: "bg-sky-50 text-sky-800 ring-sky-200",
  info_requested: "bg-amber-50 text-amber-800 ring-amber-200",
  in_progress: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  paused: "bg-zinc-100 text-zinc-700 ring-zinc-300",
  in_production: "bg-teal-600 text-white ring-teal-700",
  rejected: "bg-rose-50 text-rose-800 ring-rose-200",
  cancelled: "bg-rose-50 text-rose-700 ring-rose-200",
};

/** Agrupación para el panel (§2.3). */
export const STATUS_GROUPS = {
  solicitados: { label: "Solicitados", statuses: ["submitted", "info_requested"] },
  en_proceso: { label: "En proceso", statuses: ["in_progress", "paused"] },
  cerrados: { label: "Cerrados", statuses: ["in_production"] },
  rechazados: { label: "Rechazados / Cancelados", statuses: ["rejected", "cancelled"] },
} as const satisfies Record<string, { label: string; statuses: ProjectStatus[] }>;

export const OPEN_STATUSES: ProjectStatus[] = ["submitted", "info_requested", "in_progress", "paused"];

export const TYPE_LABEL = { PL: "Marca privada", MP: "Marca propia", MDD: "Marca de distribuidor" } as const;
export const PROJECT_TYPE_KEYS = ["PL", "MP", "MDD"] as const;
export type ProjectTypeKey = (typeof PROJECT_TYPE_KEYS)[number];
/** Tipos con cliente (brief de cliente, comercial de cuenta). */
export const CLIENT_TYPES: readonly string[] = ["PL", "MDD"];
/** Solo en PL se exige (o se asume con responsable) el anticipo del 30 % para iniciar. */
export const PREPAYMENT_TYPES: readonly string[] = ["PL"];
export const CATEGORY_LABEL = {
  perfume: "Perfumería",
  ambient: "Ambientación",
  cosmetic: "Cosmética",
} as const;
export const PRIORITY_LABEL = { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" } as const;
export const PRIORITY_COLOR = {
  low: "text-slate-500",
  medium: "text-sky-700",
  high: "text-amber-700",
  urgent: "text-rose-700 font-semibold",
} as const;

/**
 * Fases del proceso. Solo dos puertas de aprobación formales:
 * G1 (Solicitud → Cotización) y G2 (Valoración con cliente → En curso).
 * El resto de fases avanzan con una acción de "avanzar fase".
 */
export const PHASES = [
  { n: 0, name: "Solicitud", short: "Solicitud", gate: "G1", gateName: "Aprobación de la solicitud" },
  { n: 1, name: "Cotización", short: "Cotización", gate: null, gateName: null },
  { n: 2, name: "Valoración con cliente", short: "Valoración", gate: "G2", gateName: "Aprobación del presupuesto" },
  { n: 3, name: "En curso", short: "En curso", gate: null, gateName: null },
  { n: 4, name: "Desarrollo", short: "Desarrollo", gate: null, gateName: null },
  { n: 5, name: "Diseño y artes finales", short: "Diseño/AAFF", gate: null, gateName: null },
  { n: 6, name: "Preparación para producción", short: "Producción", gate: null, gateName: null },
] as const;
export const LAST_PHASE = PHASES.length - 1;
export const APPROVAL_GATES = [
  { gate: "G1", name: "Aprobación de la solicitud", phase: 0, description: "Solicitud → Cotización. Decide si el proyecto es viable y se cotiza." },
  { gate: "G2", name: "Aprobación del presupuesto", phase: 2, description: "Valoración con cliente → En curso. Comercial registra que el cliente aprueba el presupuesto." },
] as const;

/** Subcarpetas de SharePoint por fase (§9.1). */
export const PHASE_FOLDERS = [
  "00 Solicitud",
  "01 Cotización",
  "02 Valoración cliente",
  "03 En curso",
  "04 Desarrollo",
  "05 Diseño-AAFF",
  "06 Preparación producción",
] as const;

export const ROLE_LABEL = {
  admin: "Admin",
  requester: "Solicitante",
  decider: "Aprobador",
  dept_member: "Miembro de departamento",
  global_reader: "Lectura global",
} as const;

export const FILE_TAGS = {
  moodboard: "Moodboard",
  referencia: "Referencia",
  brief_cliente: "Brief del cliente",
  packaging: "Packaging",
  evidencia_cliente: "Evidencia del cliente",
  cotizacion: "Cotización",
  blacklist: "Blacklist",
  otro: "Otro",
} as const;

export const ACTION_LABEL: Record<string, string> = {
  "project.created": "creó el borrador",
  "project.submitted": "envió la solicitud",
  "project.edited": "editó el brief",
  "gate.approved": "aprobó la puerta",
  "gate.recycled": "devolvió el proyecto a cotización",
  "quote.sent": "envió la cotización al cliente",
  "phase.advanced": "avanzó de fase",
  "project.in_production": "pasó el proyecto a producción",
  "prepayment.received": "registró el anticipo del 30 %",
  "gate.info_requested": "pidió más información",
  "gate.rejected": "rechazó el proyecto",
  "gate.paused": "puso el proyecto en pausa",
  "project.resumed": "reanudó el proyecto",
  "project.cancelled": "canceló el proyecto",
  "info.answered": "respondió a la petición de información",
  "comment.created": "comentó",
  "file.uploaded": "subió un archivo",
  "file.deleted": "eliminó un archivo",
  "sharepoint.provisioned": "creó la carpeta en SharePoint",
};
