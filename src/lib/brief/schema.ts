import { z } from "zod";

/**
 * Esquema del brief del asistente de solicitud (§5). Se comparte entre el
 * formulario (cliente) y el servidor. Todos los campos son opcionales a nivel
 * de tipo porque el borrador se guarda en cada paso; la obligatoriedad al
 * enviar se comprueba con el registro de campos (fields.ts).
 */

const optStr = z
  .string()
  .trim()
  .max(5000)
  .transform((v) => (v === "" ? undefined : v))
  .optional();
const toNum = z.union([z.number(), z.string()]).transform((v, ctx) => {
  if (v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) {
    ctx.addIssue({ code: "custom", message: "Número no válido" });
    return z.NEVER;
  }
  return n;
});
const optNum = toNum.optional();
const optInt = toNum.refine((v) => v === undefined || Number.isInteger(v), "Debe ser un número entero").optional();
const strList = z.array(z.string().trim().min(1).max(200)).max(200).optional();
const isoDate = z
  .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida")])
  .transform((v) => v || undefined)
  .optional();
const emptyToUndef = <T extends z.ZodType>(schema: T) =>
  z
    .union([z.literal(""), schema])
    .transform((v) => (v === "" ? undefined : (v as z.output<T>)))
    .optional();

export const PROJECT_TYPES = ["PL", "MP", "MDD"] as const;
export const GENDERS = ["mujer", "hombre", "unisex"] as const;
export const CATEGORIES = ["perfume", "ambient", "cosmetic"] as const;
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const SUPPLIER = ["cliente", "natu", "mixto"] as const;

export const inspirationSchema = z.object({
  product: z.string().trim().max(200).default(""),
  brand: z.string().trim().max(200).default(""),
  likes: z.string().trim().max(1000).default(""),
  /** Enlace a la ficha en Fragrantica u otra web de referencia. */
  url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "Enlace no válido (debe empezar por http)")
    .default(""),
});

/** Compatibilidad: briefs antiguos con un único "gender" (femenino/masculino/unisex). */
const LEGACY_GENDER: Record<string, (typeof GENDERS)[number]> = { femenino: "mujer", masculino: "hombre", unisex: "unisex" };

export const olfactorySchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const o = { ...(raw as Record<string, unknown>) };
    if (!o.genders && typeof o.gender === "string" && LEGACY_GENDER[o.gender]) o.genders = [LEGACY_GENDER[o.gender]];
    return o;
  },
  z.object({
    families: strList,
    top: strList,
    heart: strList,
    base: strList,
    intensity: toNum.refine((v) => v === undefined || (Number.isInteger(v) && v >= 1 && v <= 5), "Entre 1 y 5").optional(),
    duration: optStr,
    inspirations: z.array(inspirationSchema).max(20).optional(),
    genders: z.array(z.enum(GENDERS)).max(3).optional(),
    /** Ingredientes / materias primas que no pueden usarse (texto pegado; también admite adjunto). */
    blacklist: z
      .string()
      .trim()
      .max(20000)
      .transform((v) => (v === "" ? undefined : v))
      .optional(),
  }),
);

export const newClientSchema = z.object({
  name: z.string().trim().min(1, "Nombre obligatorio").max(200),
  country: z.string().trim().max(100).optional(),
  contact: z.string().trim().max(500).optional(),
});

export const briefSchema = z.object({
  // Paso 1
  type: emptyToUndef(z.enum(PROJECT_TYPES)),
  category: emptyToUndef(z.enum(CATEGORIES)),
  name: optStr,
  neededBy: isoDate,
  neededByReason: optStr,
  neededByReasonText: optStr,
  priority: emptyToUndef(z.enum(PRIORITIES)),

  // Paso 2A (PL y MDD: proyectos con cliente)
  clientId: optInt,
  newClient: newClientSchema.optional(),
  accountManagerId: emptyToUndef(z.string().uuid()),
  subtype: optStr,
  references: optInt,
  firstOrderUnits: optInt,
  targetPrice: optNum,
  designBy: emptyToUndef(z.enum(SUPPLIER)),
  packagingBy: emptyToUndef(z.enum(SUPPLIER)),
  languages: strList,

  // Comunes a todos los tipos
  markets: strList,
  channels: strList,
  annualUnits: optInt,
  rrp: optNum,

  // Paso 2B (MP)
  brandId: optInt,
  line: optStr,
  origin: optStr,
  originText: optStr,
  linkedClientId: optInt,
  justification: optStr,

  // Paso 3 — Producto
  format: optStr,
  formatOther: optStr,
  capacityMl: optNum,
  performance: optStr,
  functions: strList,
  claimsText: optStr,
  skinHairType: optStr,
  audience: strList,
  texture: optStr,
  hasPerfume: z.boolean().optional(),
  ingredientsWanted: optStr,
  ingredientsAvoid: optStr,
  olfactory: olfactorySchema.optional(),

  // Paso 4
  notes: optStr,
});

export type BriefInput = z.input<typeof briefSchema>;
export type BriefData = z.output<typeof briefSchema>;
export type OlfactoryData = z.output<typeof olfactorySchema>;

/** ¿Aplica el bloque olfativo a este brief? */
export function needsOlfactory(d: BriefData) {
  return d.category === "perfume" || d.category === "ambient" || (d.category === "cosmetic" && d.hasPerfume === true);
}

/** Parseo tolerante: descarta campos inválidos en lugar de fallar (autoguardado de borrador). */
export function parseBriefLenient(input: unknown): { data: BriefData; errors: Record<string, string> } {
  const res = briefSchema.safeParse(input);
  if (res.success) return { data: res.data, errors: {} };
  const errors: Record<string, string> = {};
  const cleaned = structuredClone((input ?? {}) as Record<string, unknown>);
  for (const issue of res.error.issues) {
    const path = issue.path.map(String);
    errors[path.join(".")] = issue.message;
    // eliminar el valor inválido
    let cur: Record<string, unknown> | undefined = cleaned;
    for (let i = 0; i < path.length - 1 && cur; i++) cur = cur[path[i]!] as Record<string, unknown> | undefined;
    const last = path[path.length - 1]!;
    if (Array.isArray(cur)) cur.splice(Number(last), 1);
    else if (cur && typeof cur === "object") delete cur[last];
  }
  const second = briefSchema.safeParse(cleaned);
  return { data: second.success ? second.data : {}, errors };
}
