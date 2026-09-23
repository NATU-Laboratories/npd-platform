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

export const TYPE_LABEL = { PL: "Marca privada", MP: "Marca propia" } as const;
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

export const PHASES = [
  { n: 0, name: "Solicitud", short: "Solicitud", gate: "G1", gateName: "Viabilidad" },
  { n: 1, name: "Validez del concepto", short: "Concepto", gate: "G2", gateName: "Validez del mix" },
  { n: 2, name: "Desarrollo", short: "Desarrollo", gate: "G3", gateName: "Muestra aprobada" },
  { n: 3, name: "Diseño y artes finales", short: "Diseño/AAFF", gate: "G4", gateName: "AAFF aprobados" },
  { n: 4, name: "Preparación para producción", short: "Producción", gate: "G5", gateName: "Listo para producción" },
] as const;

/** Subcarpetas de SharePoint por fase (§9.1). */
export const PHASE_FOLDERS = [
  "00 Solicitud",
  "01 Concepto",
  "02 Desarrollo",
  "03 Diseño-AAFF",
  "04 Preparación producción",
] as const;

export const ROLE_LABEL = {
  admin: "Admin",
  requester: "Solicitante",
  decider: "Decisor",
  dept_member: "Miembro de departamento",
  global_reader: "Lectura global",
} as const;

export const FILE_TAGS = {
  moodboard: "Moodboard",
  referencia: "Referencia",
  brief_cliente: "Brief del cliente",
  packaging: "Packaging",
  evidencia_cliente: "Evidencia del cliente",
  otro: "Otro",
} as const;

export const ACTION_LABEL: Record<string, string> = {
  "project.created": "creó el borrador",
  "project.submitted": "envió la solicitud",
  "project.edited": "editó el brief",
  "gate.approved": "aprobó la puerta",
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
