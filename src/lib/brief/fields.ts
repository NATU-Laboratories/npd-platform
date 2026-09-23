import { needsOlfactory, type BriefData } from "./schema";

export type FieldLevel = "required" | "recommended" | "optional";

export type FieldDef = {
  key: string;
  label: string;
  step: 1 | 2 | 3 | 4;
  level: FieldLevel;
  /** El campo solo aplica si devuelve true. */
  when?: (d: BriefData) => boolean;
  /** Comprobación personalizada de "relleno". */
  filled?: (d: BriefData) => boolean;
};

const isPL = (d: BriefData) => d.type === "PL";
const isMP = (d: BriefData) => d.type === "MP";
const isCat = (c: BriefData["category"]) => (d: BriefData) => d.category === c;

/** Registro único de campos del brief: etiquetas, paso y obligatoriedad (§5). */
export const FIELDS: FieldDef[] = [
  // Paso 1
  { key: "type", label: "Tipo de proyecto", step: 1, level: "required" },
  { key: "category", label: "Categoría", step: 1, level: "required" },
  { key: "name", label: "Nombre provisional", step: 1, level: "required" },
  { key: "neededBy", label: "Fecha necesaria", step: 1, level: "required" },
  { key: "neededByReason", label: "Motivo de la fecha", step: 1, level: "required" },
  { key: "priority", label: "Prioridad sugerida", step: 1, level: "required" },

  // Paso 2A — PL
  {
    key: "clientId",
    label: "Cliente",
    step: 2,
    level: "required",
    when: isPL,
    filled: (d) => !!d.clientId || !!d.newClient?.name,
  },
  { key: "accountManagerId", label: "Comercial responsable", step: 2, level: "required", when: isPL },
  { key: "subtype", label: "Subtipo", step: 2, level: "required", when: isPL },
  { key: "markets", label: "Mercados de venta", step: 2, level: "required" , when: (d) => !!d.type },
  { key: "channels", label: "Canal", step: 2, level: "required", when: (d) => !!d.type },
  { key: "references", label: "Nº de referencias", step: 2, level: "required", when: isPL },
  { key: "firstOrderUnits", label: "Unidades primer pedido", step: 2, level: "required", when: isPL },
  { key: "annualUnits", label: "Previsión anual de unidades", step: 2, level: "recommended", when: (d) => !!d.type },
  { key: "targetPrice", label: "Precio objetivo de compra", step: 2, level: "recommended", when: isPL },
  { key: "rrp", label: "PVP previsto / objetivo", step: 2, level: "recommended", when: (d) => !!d.type },
  { key: "designBy", label: "Quién aporta el diseño", step: 2, level: "required", when: isPL },
  { key: "packagingBy", label: "Quién aporta el packaging", step: 2, level: "required", when: isPL },
  { key: "languages", label: "Idiomas de etiquetado", step: 2, level: "recommended", when: isPL },

  // Paso 2B — MP
  { key: "brandId", label: "Marca", step: 2, level: "required", when: isMP },
  { key: "line", label: "Línea / colección", step: 2, level: "optional", when: isMP },
  { key: "origin", label: "Origen", step: 2, level: "required", when: isMP },
  { key: "linkedClientId", label: "Cliente/retailer vinculado", step: 2, level: "optional", when: isMP },
  { key: "justification", label: "Justificación / oportunidad", step: 2, level: "required", when: isMP },

  // Paso 3 — Producto
  { key: "format", label: "Formato", step: 3, level: "required", when: (d) => !!d.category },
  { key: "capacityMl", label: "Capacidad (ml)", step: 3, level: "recommended", when: (d) => !!d.category },
  { key: "performance", label: "Duración / rendimiento", step: 3, level: "recommended", when: isCat("ambient") },
  { key: "functions", label: "Función y claims", step: 3, level: "recommended", when: isCat("cosmetic") },
  { key: "skinHairType", label: "Tipo de piel/cabello", step: 3, level: "recommended", when: isCat("cosmetic") },
  { key: "audience", label: "Público", step: 3, level: "recommended", when: isCat("cosmetic") },
  { key: "texture", label: "Textura deseada", step: 3, level: "recommended", when: isCat("cosmetic") },
  {
    key: "hasPerfume",
    label: "¿Lleva perfume?",
    step: 3,
    level: "required",
    when: isCat("cosmetic"),
    filled: (d) => typeof d.hasPerfume === "boolean",
  },
  { key: "ingredientsWanted", label: "Ingredientes deseados", step: 3, level: "optional", when: isCat("cosmetic") },
  { key: "ingredientsAvoid", label: "Ingredientes a evitar", step: 3, level: "optional", when: isCat("cosmetic") },

  // Bloque olfativo
  { key: "olfactory.families", label: "Familias olfativas", step: 3, level: "required", when: needsOlfactory },
  {
    key: "olfactory.notes",
    label: "Notas (salida / corazón / fondo)",
    step: 3,
    level: "recommended",
    when: needsOlfactory,
    filled: (d) => !!(d.olfactory?.top?.length || d.olfactory?.heart?.length || d.olfactory?.base?.length),
  },
  { key: "olfactory.intensity", label: "Intensidad", step: 3, level: "recommended", when: needsOlfactory },
  {
    key: "olfactory.inspirations",
    label: "Referencias de inspiración",
    step: 3,
    level: "recommended",
    when: needsOlfactory,
    filled: (d) => !!d.olfactory?.inspirations?.some((i) => i.product || i.brand),
  },
  { key: "olfactory.gender", label: "Público (género)", step: 3, level: "recommended", when: needsOlfactory },
  { key: "olfactory.seasonality", label: "Estacionalidad", step: 3, level: "optional", when: needsOlfactory },

  // Paso 4
  { key: "notes", label: "Notas adicionales", step: 4, level: "optional" },
];

export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
}

function isFilledValue(v: unknown) {
  if (v === undefined || v === null || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function isFieldFilled(f: FieldDef, d: BriefData) {
  return f.filled ? f.filled(d) : isFilledValue(getPath(d, f.key));
}

export function applicableFields(d: BriefData) {
  return FIELDS.filter((f) => !f.when || f.when(d));
}

/** % de campos obligatorios + recomendados cubiertos (§5, indicador de completitud). */
export function computeCompleteness(d: BriefData) {
  const counted = applicableFields(d).filter((f) => f.level !== "optional");
  // Sin tipo/categoría todavía no conocemos todos los campos: contamos los mínimos del paso 2/3.
  const placeholders = (d.type ? 0 : 6) + (d.category ? 0 : 3);
  const filled = counted.filter((f) => isFieldFilled(f, d)).length;
  const total = counted.length + placeholders;
  return total === 0 ? 0 : Math.round((filled / total) * 100);
}

export function missingFields(d: BriefData, level: FieldLevel) {
  return applicableFields(d).filter((f) => f.level === level && !isFieldFilled(f, d));
}

/** Errores bloqueantes para enviar: campos obligatorios vacíos. */
export function submitErrors(d: BriefData): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of missingFields(d, "required")) errors[f.key] = `${f.label} es obligatorio`;
  if (d.neededByReason === "otro" && !d.neededByReasonText) errors.neededByReasonText = "Explica el motivo de la fecha";
  if (d.format === "otro" && !d.formatOther) errors.formatOther = "Indica el formato";
  return errors;
}
