import type { ReplenishmentStatus } from "@/db/schema";

/**
 * Reposiciones: productos/proyectos ya desarrollados que se vuelven a fabricar.
 * Plantilla «Repetición»: Diseño revisa si hay cambios y prepara el arte final,
 * Calidad lo valida (puede pedir correcciones) y Compras recotiza y envía a imprenta.
 */

export const REPLENISHMENT_TEMPLATES = {
  repeticion: {
    label: "Repetición",
    description: "Reposición de un producto ya desarrollado para enviar a imprenta (etiquetas, estuches…). Diseño revisa y confirma el arte final, Calidad lo valida y Compras recotiza con el proveedor.",
  },
} as const;
export type ReplenishmentTemplate = keyof typeof REPLENISHMENT_TEMPLATES;

/** Elementos que se pueden reponer. */
export const ELEMENTS = [
  { key: "etiqueta", label: "Etiqueta" },
  { key: "estuche", label: "Estuche" },
  { key: "caja_master", label: "Caja master" },
  { key: "envase", label: "Envase / frasco" },
  { key: "tapon", label: "Tapón / cierre" },
  { key: "prospecto", label: "Prospecto / folleto" },
  { key: "otro", label: "Otro" },
] as const;
export const ELEMENT_LABEL: Record<string, string> = Object.fromEntries(ELEMENTS.map((e) => [e.key, e.label]));
/** Elementos impresos: pasan por revisión de diseño y validación del arte final. */
export const PRINTED_ELEMENTS = ["etiqueta", "estuche", "caja_master", "prospecto"];

export const STATUS_STEPS: { key: ReplenishmentStatus; label: string; dept: "diseno" | "calidad" | "compras" | null }[] = [
  { key: "design_review", label: "Revisión de diseño", dept: "diseno" },
  { key: "design_changes", label: "Correcciones de diseño", dept: "diseno" },
  { key: "quality_review", label: "Validación de calidad", dept: "calidad" },
  { key: "art_approved", label: "Arte final aprobado", dept: "compras" },
  { key: "sent_to_print", label: "Enviado a imprenta", dept: "compras" },
  { key: "closed", label: "Cerrada", dept: null },
];

export const REP_STATUS_LABEL: Record<ReplenishmentStatus, string> = {
  design_review: "Revisión de diseño",
  design_changes: "Correcciones de diseño",
  quality_review: "Validación de calidad",
  art_approved: "Arte final aprobado",
  sent_to_print: "Enviado a imprenta",
  closed: "Cerrada",
  cancelled: "Cancelada",
};

export const REP_STATUS_COLOR: Record<ReplenishmentStatus, string> = {
  design_review: "bg-pink-50 text-pink-800 ring-pink-200",
  design_changes: "bg-amber-50 text-amber-800 ring-amber-200",
  quality_review: "bg-sky-50 text-sky-800 ring-sky-200",
  art_approved: "bg-[#eef0e6] text-[#56613f] ring-natu-sage",
  sent_to_print: "bg-natu-dark text-white ring-natu-dark",
  closed: "bg-slate-100 text-slate-600 ring-slate-200",
  cancelled: "bg-rose-50 text-rose-700 ring-rose-200",
};

export const OPEN_REP_STATUSES: ReplenishmentStatus[] = ["design_review", "design_changes", "quality_review", "art_approved", "sent_to_print"];

export const QUOTE_STATUS_LABEL: Record<string, string> = {
  pending: "Sin pedir",
  requested: "Pedida al proveedor",
  received: "Recibida",
};

export const REP_FILE_TAGS = {
  arte_final: "Arte final",
  prueba: "Prueba / maqueta",
  referencia: "Referencia (versión anterior)",
  cotizacion: "Cotización del proveedor",
  otro: "Otro",
} as const;

export const REP_ACTION_LABEL: Record<string, string> = {
  "replenishment.created": "abrió la solicitud de reposición",
  "replenishment.design_no_changes": "confirmó que no hay cambios de diseño",
  "replenishment.design_changes": "indicó que hay cambios de diseño",
  "replenishment.design_ready": "entregó el arte final para validar",
  "replenishment.quality_approved": "validó el arte final",
  "replenishment.quality_corrections": "pidió correcciones del arte final",
  "replenishment.sent_to_print": "envió a imprenta",
  "replenishment.closed": "cerró la reposición",
  "replenishment.cancelled": "canceló la reposición",
  "replenishment.reopened": "reabrió la reposición",
  "replenishment.quote_requested": "pidió recotización al proveedor",
  "replenishment.quote_received": "registró la recotización",
  "replenishment.edited": "editó la solicitud",
  "replenishment.comment": "comentó",
  "replenishment.file_uploaded": "subió un archivo",
  "replenishment.file_deleted": "eliminó un archivo",
};
