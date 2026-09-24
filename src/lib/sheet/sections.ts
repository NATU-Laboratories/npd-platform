/**
 * Ficha técnica del proyecto: apartados que cada departamento completa
 * conforme avanza el proyecto. Módulo puro (cliente y servidor).
 *
 * - Cada apartado pertenece a un departamento (por clave; reasignable en el
 *   backoffice) y a la fase en la que debe completarse.
 * - Los miembros del departamento (y el decisor global) editan su apartado y lo marcan como
 *   terminado (solo si no falta nada obligatorio) o como "no aplica".
 */

export type Opt = { value: string; label: string };

type Base = { key: string; label: string; required?: boolean; hint?: string; when?: (c: SheetCtx) => boolean };
export type ScalarField =
  | (Base & { type: "text" | "textarea"; placeholder?: string })
  | (Base & { type: "money" | "number"; unit?: string })
  | (Base & { type: "date" })
  | (Base & { type: "bool" })
  | (Base & { type: "select" | "multi"; options: Opt[] })
  | (Base & { type: "tags"; placeholder?: string; tone?: "top" | "heart" | "base" });
export type SheetField =
  | ScalarField
  | (Base & { type: "files"; tag: string })
  | (Base & {
      type: "list";
      item: ScalarField[];
      addLabel: string;
      itemLabel: string;
      /** Al menos un elemento con este campo booleano a true. */
      requireSome?: { key: string; label: string };
    });

export type SheetGroup = { title?: string; fields: SheetField[] };
export type SheetCheck = { label: string; ok: (c: SheetCtx) => boolean; detail?: (c: SheetCtx) => string | null };

export type SheetSection = {
  key: string;
  title: string;
  titleFor?: (c: SheetCtx) => string;
  description: string;
  /** Departamento por defecto (clave de `departments.key`). */
  dept: string;
  /** Fase en la que debe completarse. */
  phase: number;
  /** Requisitos automáticos que salen del flujo (cotización enviada, G2…). */
  checks?: SheetCheck[];
  groups: SheetGroup[];
  prefill?: (c: SheetCtx) => Record<string, unknown>;
};

/** Contexto del proyecto necesario para evaluar la ficha. */
export type SheetCtx = {
  olfactory: boolean;
  quotedAt: string | null;
  quoteAmount: number | null;
  g2At: string | null;
  prepayment: string | null;
  brief: { targetPrice?: number | null; rrp?: number | null; unitsFirstOrder?: number | null; capacityMl?: number | null; references?: number | null };
  filesByTag: Record<string, number>;
};

export type SheetData = Record<string, unknown>;
export type SheetStatus = "pending" | "done" | "na";

const euro = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" });

export const PICTOGRAMS: Opt[] = [
  { value: "GHS02", label: "GHS02 · Inflamable" },
  { value: "GHS05", label: "GHS05 · Corrosivo" },
  { value: "GHS07", label: "GHS07 · Irritante / nocivo" },
  { value: "GHS08", label: "GHS08 · Peligro para la salud" },
  { value: "GHS09", label: "GHS09 · Peligro para el medio ambiente" },
  { value: "pao", label: "PAO (periodo tras la apertura)" },
  { value: "reloj", label: "Reloj de arena (consumo preferente)" },
  { value: "libro", label: "Mano con libro (ver información adjunta)" },
  { value: "e", label: "℮ (cantidad estimada)" },
  { value: "triman", label: "Triman / info de reciclaje" },
  { value: "punto_verde", label: "Punto verde" },
];

export const LANGUAGES: Opt[] = [
  { value: "es", label: "Español" },
  { value: "en", label: "Inglés" },
  { value: "fr", label: "Francés" },
  { value: "it", label: "Italiano" },
  { value: "pt", label: "Portugués" },
  { value: "de", label: "Alemán" },
  { value: "ro", label: "Rumano" },
  { value: "nl", label: "Neerlandés" },
  { value: "pl", label: "Polaco" },
  { value: "el", label: "Griego" },
  { value: "ar", label: "Árabe" },
];

export const SHEET_SECTIONS: SheetSection[] = [
  {
    key: "comercial",
    title: "Cotización y condiciones comerciales",
    description: "Cotización enviada, precios acordados y aprobación final del cliente.",
    dept: "comercial",
    phase: 1,
    checks: [
      {
        label: "Cotización enviada al cliente",
        ok: (c) => !!c.quotedAt,
        detail: (c) => (c.quotedAt ? `${fmtDate(c.quotedAt)}${c.quoteAmount != null ? ` · ${euro(c.quoteAmount)}` : ""}` : null),
      },
      {
        label: "Presupuesto aprobado por el cliente (G2)",
        ok: (c) => !!c.g2At,
        detail: (c) => (c.g2At ? [fmtDate(c.g2At), c.prepayment].filter(Boolean).join(" · ") : null),
      },
    ],
    groups: [
      {
        title: "Precios",
        fields: [
          { key: "unitPrice", label: "Precio unitario cotizado", type: "money", unit: "€/ud", required: true },
          { key: "targetPrice", label: "Precio objetivo", type: "money", unit: "€/ud", required: true },
          { key: "rrp", label: "PVP recomendado", type: "money", unit: "€", required: true },
          { key: "units", label: "Unidades del primer pedido", type: "number", unit: "uds" },
          { key: "conditions", label: "Condiciones", type: "textarea", placeholder: "Plazos de entrega, forma de pago, portes, validez de la oferta…" },
        ],
      },
      {
        title: "Documentos",
        fields: [
          { key: "quoteFiles", label: "Cotización enviada", type: "files", tag: "cotizacion" },
          { key: "approvalFiles", label: "Aprobación del cliente (presupuesto firmado, pedido o email)", type: "files", tag: "aprobacion_cliente" },
        ],
      },
    ],
    prefill: (c) => ({ targetPrice: c.brief.targetPrice ?? undefined, rrp: c.brief.rrp ?? undefined, units: c.brief.unitsFirstOrder ?? undefined }),
  },
  {
    key: "formula",
    title: "Fórmula y pirámide olfativa",
    titleFor: (c) => (c.olfactory ? "Fórmula y pirámide olfativa" : "Fórmula"),
    description: "Referencias desarrolladas por el laboratorio y cuáles ha aprobado el cliente, con su pirámide olfativa.",
    dept: "idi",
    phase: 3,
    groups: [
      {
        fields: [
          {
            key: "references",
            label: "Referencias desarrolladas",
            type: "list",
            required: true,
            addLabel: "Añadir referencia",
            itemLabel: "Referencia",
            requireSome: { key: "approved", label: "Al menos una referencia aprobada por el cliente" },
            item: [
              { key: "name", label: "Nombre / referencia", type: "text", required: true },
              { key: "code", label: "Código de fórmula", type: "text" },
              { key: "top", label: "Notas de salida", type: "tags", tone: "top", required: true, when: (c) => c.olfactory, placeholder: "p. ej. bergamota" },
              { key: "heart", label: "Notas de corazón", type: "tags", tone: "heart", required: true, when: (c) => c.olfactory, placeholder: "p. ej. jazmín" },
              { key: "base", label: "Notas de fondo", type: "tags", tone: "base", required: true, when: (c) => c.olfactory, placeholder: "p. ej. vainilla" },
              { key: "approved", label: "Aprobada por el cliente", type: "bool" },
              { key: "approvedAt", label: "Fecha de aprobación", type: "date" },
              { key: "comments", label: "Observaciones", type: "textarea" },
            ],
          },
        ],
      },
      { fields: [{ key: "formulaFiles", label: "Fichas técnicas y resultados de pruebas", type: "files", tag: "formula" }] },
    ],
  },
  {
    key: "packaging",
    title: "Envase y packaging",
    description: "Frasco, tapón y packaging secundario seleccionados para el proyecto.",
    dept: "marketing",
    phase: 3,
    groups: [
      {
        title: "Frasco",
        fields: [
          { key: "bottleModel", label: "Modelo", type: "text", required: true },
          { key: "bottleSupplier", label: "Proveedor", type: "text" },
          { key: "bottleCapacity", label: "Capacidad", type: "number", unit: "ml" },
          { key: "bottleFinish", label: "Material, color y acabado", type: "text" },
        ],
      },
      {
        title: "Tapón y cierre",
        fields: [
          { key: "capModel", label: "Tapón", type: "text", required: true },
          { key: "capSupplier", label: "Proveedor", type: "text" },
          { key: "capFinish", label: "Material, color y acabado", type: "text" },
          { key: "pump", label: "Bomba / válvula / difusor", type: "text" },
        ],
      },
      {
        title: "Packaging secundario",
        fields: [
          {
            key: "secondaryType",
            label: "Tipo",
            type: "select",
            required: true,
            options: [
              { value: "estuche", label: "Estuche" },
              { value: "caja", label: "Caja / cofre" },
              { value: "blister", label: "Blíster" },
              { value: "sin", label: "Sin packaging secundario" },
            ],
          },
          { key: "secondaryDetail", label: "Material, dimensiones y acabados", type: "textarea" },
        ],
      },
      { fields: [{ key: "packagingFiles", label: "Fotos, planos o fichas de los componentes", type: "files", tag: "packaging" }] },
    ],
    prefill: (c) => ({ bottleCapacity: c.brief.capacityMl ?? undefined }),
  },
  {
    key: "regulatorio",
    title: "Calidad y regulatorio · requisitos de etiqueta",
    description: "Pictogramas, INCI, idiomas y advertencias que debe llevar la etiqueta.",
    dept: "calidad",
    phase: 3,
    groups: [
      {
        fields: [
          { key: "pictograms", label: "Pictogramas y símbolos", type: "multi", options: PICTOGRAMS, required: true },
          { key: "languages", label: "Idiomas de la etiqueta", type: "multi", options: LANGUAGES, required: true },
          { key: "inci", label: "Lista INCI", type: "textarea", required: true, placeholder: "ALCOHOL DENAT., PARFUM (FRAGRANCE), AQUA (WATER)…" },
          { key: "allergens", label: "Alérgenos a declarar", type: "textarea" },
          { key: "warnings", label: "Advertencias y frases (H/P, precauciones de uso)", type: "textarea" },
          { key: "nominal", label: "Contenido nominal", type: "text", placeholder: "p. ej. 100 ml ℮" },
          { key: "pao", label: "PAO / caducidad", type: "text", placeholder: "p. ej. 24M" },
          { key: "responsible", label: "Persona responsable (UE)", type: "text" },
          { key: "ufi", label: "Código UFI", type: "text" },
          { key: "cpnp", label: "Nº de notificación CPNP", type: "text" },
        ],
      },
      { fields: [{ key: "regFiles", label: "Documentación (IFRA, FDS, CPSR, certificados)", type: "files", tag: "regulatorio" }] },
    ],
  },
  {
    key: "etiqueta",
    title: "Etiqueta y artes finales",
    description: "Detalles de la etiqueta y artes finales aprobados por el cliente.",
    dept: "diseno",
    phase: 4,
    groups: [
      {
        fields: [
          {
            key: "labelType",
            label: "Tipo de etiqueta",
            type: "select",
            required: true,
            options: [
              { value: "adhesiva", label: "Adhesiva" },
              { value: "serigrafia", label: "Serigrafía" },
              { value: "estampacion", label: "Estampación en caliente" },
              { value: "sleeve", label: "Sleeve / funda retráctil" },
              { value: "otra", label: "Otra" },
            ],
          },
          {
            key: "placements",
            label: "Ubicación",
            type: "multi",
            required: true,
            options: [
              { value: "frontal", label: "Frontal" },
              { value: "trasera", label: "Trasera" },
              { value: "base", label: "Base" },
              { value: "estuche", label: "Estuche" },
            ],
          },
          { key: "size", label: "Dimensiones", type: "text", placeholder: "p. ej. 40 × 60 mm" },
          { key: "material", label: "Material y acabado", type: "text" },
          { key: "inks", label: "Colores / tintas", type: "text" },
          { key: "texts", label: "Textos principales", type: "textarea", placeholder: "Nombre, denominación, contenido nominal…" },
        ],
      },
      {
        fields: [
          { key: "artworkFiles", label: "Artes finales", type: "files", tag: "arte_final", required: true },
          { key: "clientApproved", label: "Artes finales aprobados por el cliente", type: "bool", required: true },
          { key: "clientApprovedAt", label: "Fecha de aprobación", type: "date" },
        ],
      },
    ],
  },
  {
    key: "produccion",
    title: "Preparación para producción",
    description: "Materiales pedidos, escandallo final y fecha prevista de fabricación.",
    dept: "operaciones",
    phase: 5,
    groups: [
      {
        fields: [
          { key: "productionDate", label: "Fecha prevista de producción", type: "date", required: true },
          { key: "materialsOrdered", label: "Materiales y envases pedidos", type: "bool", required: true },
          { key: "pilotApproved", label: "Lote piloto validado", type: "bool" },
          { key: "costFiles", label: "Escandallo final", type: "files", tag: "escandallo", required: true },
          { key: "notes", label: "Notas", type: "textarea" },
        ],
      },
    ],
  },
];

export const SECTION_BY_KEY: Record<string, SheetSection> = Object.fromEntries(SHEET_SECTIONS.map((s) => [s.key, s]));

export function sectionTitle(s: SheetSection, c: SheetCtx) {
  return s.titleFor?.(c) ?? s.title;
}

export function applicable<T extends { when?: (c: SheetCtx) => boolean }>(fields: T[], c: SheetCtx) {
  return fields.filter((f) => !f.when || f.when(c));
}

export function allFields(s: SheetSection, c: SheetCtx) {
  return applicable(
    s.groups.flatMap((g) => g.fields),
    c,
  );
}

/** Valores efectivos: datos guardados sobre los precargados del brief. */
export function effectiveData(s: SheetSection, c: SheetCtx, data: SheetData | null | undefined): SheetData {
  const pre = Object.fromEntries(Object.entries(s.prefill?.(c) ?? {}).filter(([, v]) => v != null && v !== ""));
  return { ...pre, ...(data ?? {}) };
}

export function isScalarFilled(f: ScalarField, v: unknown): boolean {
  switch (f.type) {
    case "bool":
      return v === true;
    case "money":
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "multi":
    case "tags":
      return Array.isArray(v) && v.length > 0;
    default:
      return typeof v === "string" && v.trim() !== "";
  }
}

export type Requirement = { label: string; ok: boolean; detail?: string | null };

/** Lista de requisitos (obligatorios + automáticos) con su estado. */
export function requirements(s: SheetSection, c: SheetCtx, data: SheetData): Requirement[] {
  const out: Requirement[] = (s.checks ?? []).map((ch) => ({ label: ch.label, ok: ch.ok(c), detail: ch.detail?.(c) ?? null }));
  for (const f of allFields(s, c)) {
    if (f.type === "files") {
      if (f.required) out.push({ label: f.label, ok: (c.filesByTag[f.tag] ?? 0) > 0 });
      continue;
    }
    if (f.type === "list") {
      const items = (Array.isArray(data[f.key]) ? data[f.key] : []) as SheetData[];
      if (f.required) out.push({ label: `${f.label}: al menos una`, ok: items.length > 0 });
      const sub = applicable(f.item, c).filter((x) => x.required);
      items.forEach((it, i) => {
        const missing = sub.filter((x) => !isScalarFilled(x, it[x.key])).map((x) => x.label);
        if (missing.length) out.push({ label: `${f.itemLabel} ${i + 1} (${String(it.name || "sin nombre")}): falta ${missing.join(", ").toLowerCase()}`, ok: false });
      });
      if (f.requireSome) out.push({ label: f.requireSome.label, ok: items.some((it) => it[f.requireSome!.key] === true) });
      continue;
    }
    if (f.required) out.push({ label: f.label, ok: isScalarFilled(f, data[f.key]) });
  }
  return out;
}

export function progress(reqs: Requirement[]) {
  const done = reqs.filter((r) => r.ok).length;
  return { done, total: reqs.length, complete: done === reqs.length };
}

/** Limpia y valida los datos enviados desde el editor (servidor). */
export function sanitizeData(s: SheetSection, raw: unknown): SheetData {
  const src = (raw && typeof raw === "object" ? raw : {}) as SheetData;
  const out: SheetData = {};
  const scalar = (f: ScalarField, v: unknown): unknown => {
    switch (f.type) {
      case "bool":
        return v === true ? true : undefined;
      case "money":
      case "number": {
        const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".")) : NaN;
        return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
      }
      case "date":
        return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
      case "select":
        return typeof v === "string" && f.options.some((o) => o.value === v) ? v : undefined;
      case "multi":
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && f.options.some((o) => o.value === x)) : undefined;
      case "tags":
        return Array.isArray(v)
          ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 80)).filter(Boolean))].slice(0, 40)
          : undefined;
      default:
        return typeof v === "string" && v.trim() ? v.trim().slice(0, f.type === "textarea" ? 8000 : 300) : undefined;
    }
  };
  for (const f of s.groups.flatMap((g) => g.fields)) {
    if (f.type === "files") continue;
    if (f.type === "list") {
      const items = Array.isArray(src[f.key]) ? (src[f.key] as unknown[]).slice(0, 30) : [];
      out[f.key] = items
        .map((it) => {
          const o = (it && typeof it === "object" ? it : {}) as SheetData;
          const clean: SheetData = {};
          for (const x of f.item) {
            const v = scalar(x, o[x.key]);
            if (v !== undefined) clean[x.key] = v;
          }
          return clean;
        })
        .filter((o) => Object.keys(o).length > 0);
      continue;
    }
    const v = scalar(f, src[f.key]);
    if (v !== undefined) out[f.key] = v;
  }
  return out;
}

/** Texto legible de un valor (vista de lectura, emails, historial). */
export function formatValue(f: ScalarField, v: unknown): string | null {
  if (!isScalarFilled(f, v) && !(f.type === "bool" && v === false)) return null;
  switch (f.type) {
    case "bool":
      return v ? "Sí" : "No";
    case "money":
      return `${(v as number).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${f.unit ?? "€"}`;
    case "number":
      return `${(v as number).toLocaleString("es-ES")}${f.unit ? ` ${f.unit}` : ""}`;
    case "date":
      return new Date(`${v as string}T12:00:00`).toLocaleDateString("es-ES");
    case "select":
      return f.options.find((o) => o.value === v)?.label ?? String(v);
    case "multi":
      return (v as string[]).map((x) => f.options.find((o) => o.value === x)?.label ?? x).join(", ");
    case "tags":
      return (v as string[]).join(", ");
    default:
      return String(v);
  }
}
