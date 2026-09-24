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

type Base = {
  key: string;
  label: string;
  required?: boolean;
  /** Obligatorio solo si se cumple la condición sobre los datos del apartado (p. ej. "Otro" → especificar). */
  requiredIf?: (d: SheetData) => boolean;
  /** Validación adicional del valor (p. ej. longitud del código de barras). */
  valid?: (v: unknown, d: SheetData) => boolean;
  invalidLabel?: string;
  hint?: string;
  when?: (c: SheetCtx) => boolean;
};
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
  /** Apartados cuya información necesita este (se le envía al abrirse su fase). */
  dependsOn?: string[];
};

/** Contexto del proyecto necesario para evaluar la ficha. */
export type SheetCtx = {
  olfactory: boolean;
  quotedAt: string | null;
  quoteAmount: number | null;
  g2At: string | null;
  prepayment: string | null;
  brief: {
    name?: string | null;
    format?: string | null;
    markets?: string[];
    targetPrice?: number | null;
    rrp?: number | null;
    unitsFirstOrder?: number | null;
    capacityMl?: number | null;
    references?: number | null;
  };
  filesByTag: Record<string, number>;
};

export type SheetData = Record<string, unknown>;
export type SheetStatus = "pending" | "done" | "na";

const euro = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" });

const opts = (xs: [string, string][]): Opt[] => xs.map(([value, label]) => ({ value, label }));

export const DENOMINATIONS = opts([
  ["agua_colonia", "Agua de colonia"],
  ["agua_tocador", "Agua de tocador (EDT)"],
  ["agua_perfume", "Agua de perfume"],
  ["perfume", "Perfume"],
  ["ambientador_mikado", "Ambientador mikado"],
  ["home_spray", "Home spray"],
  ["sobre_percha", "Sobre / percha perfumada"],
  ["bruma_textil", "Bruma textil"],
  ["mikado", "Mikado"],
  ["otro", "Otro"],
]);
/** Formato del brief → denominación legal (precarga). */
const DENOMINATION_FROM_FORMAT: Record<string, string> = {
  edt: "agua_tocador",
  edp: "agua_perfume",
  colonia: "agua_colonia",
  colonia_infantil: "agua_colonia",
  extracto: "perfume",
  mikado: "ambientador_mikado",
  spray: "home_spray",
  sachet: "sobre_percha",
  textil: "bruma_textil",
};

export const LANGUAGES = opts([
  ["es", "Español"],
  ["en", "Inglés"],
  ["fr", "Francés"],
  ["it", "Italiano"],
  ["de", "Alemán"],
  ["pt", "Portugués"],
  ["ro", "Rumano"],
  ["pl", "Polaco"],
  ["nl", "Neerlandés"],
  ["el", "Griego"],
  ["ar", "Árabe"],
]);
/** Mercados del brief → idiomas de la etiqueta (precarga). */
const LANGUAGES_FROM_MARKET: Record<string, string[]> = {
  ES: ["es"],
  MX: ["es"],
  PT: ["pt"],
  FR: ["fr"],
  IT: ["it"],
  DE: ["de"],
  RO: ["ro"],
  PL: ["pl"],
  GB: ["en"],
  US: ["en"],
  NL: ["nl"],
  BE: ["fr", "nl"],
  GR: ["el"],
  MA: ["ar", "fr"],
  AE: ["ar", "en"],
  SA: ["ar"],
};

export const RECYCLING_ICONS = opts([
  ["reciclable", "Envase reciclable"],
  ["material", "Material del envase"],
  ["separacion", "Separación de componentes"],
  ["tidyman", "Tidyman"],
  ["triman", "Triman (Francia)"],
  ["punto_verde", "Punto verde"],
  ["otros", "Otros"],
]);
export const HAZARD_ICONS = opts([
  ["ninguno", "No lleva iconos de peligro"],
  ["GHS02", "Inflamable (GHS02)"],
  ["GHS07", "Irritante (GHS07)"],
  ["GHS09", "Medio ambiente (GHS09)"],
  ["GHS05", "Corrosivo (GHS05)"],
  ["GHS08", "Peligro para la salud (GHS08)"],
  ["otros", "Otros"],
]);
export const OTHER_ICONS = opts([
  ["pao", "PAO / duración tras apertura"],
  ["reloj", "Reloj de arena (consumo preferente)"],
  ["libro", "Mano con libro (ver información adjunta)"],
  ["otros", "Otros"],
]);

const has = (key: string, value: string) => (d: SheetData) => Array.isArray(d[key]) && (d[key] as string[]).includes(value);
const is = (key: string, value: string) => (d: SheetData) => d[key] === value;
const digits = (n: number) => (v: unknown) => typeof v === "string" && new RegExp(`^\\d{${n}}$`).test(v.replace(/\s/g, ""));

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
        label: "Presupuesto aprobado por el cliente (P2)",
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
    key: "identificacion",
    title: "Identificación del producto",
    description: "Nombre comercial, código de barras y QR que llevará el producto.",
    dept: "marketing",
    phase: 3,
    groups: [
      {
        fields: [
          { key: "productName", label: "Nombre comercial (naming)", type: "text", required: true, hint: "Precargado con el nombre del proyecto: confirma el definitivo." },
          { key: "fragranceName", label: "Nombre de la fragancia", type: "text", hint: "Si es distinto del nombre comercial." },
        ],
      },
      {
        title: "Código de barras",
        fields: [
          {
            key: "barcodeType",
            label: "Tipo",
            type: "select",
            required: true,
            options: opts([
              ["ean13", "EAN-13"],
              ["ean8", "EAN-8"],
              ["no", "No lleva"],
            ]),
          },
          {
            key: "barcode",
            label: "Código",
            type: "text",
            requiredIf: (d) => d.barcodeType === "ean13" || d.barcodeType === "ean8",
            valid: (v, d) => (d.barcodeType === "ean8" ? digits(8)(v) : d.barcodeType === "ean13" ? digits(13)(v) : true),
            invalidLabel: "Código de barras: 13 dígitos (EAN-13) u 8 (EAN-8)",
          },
        ],
      },
      {
        title: "QR",
        fields: [
          {
            key: "qr",
            label: "¿Lleva QR?",
            type: "select",
            required: true,
            options: opts([
              ["no", "No"],
              ["si", "Sí"],
            ]),
          },
          { key: "qrContent", label: "Destino del QR (URL o contenido)", type: "text", requiredIf: is("qr", "si") },
        ],
      },
    ],
    prefill: (c) => ({ productName: c.brief.name ?? undefined }),
  },
  {
    key: "regulatorio",
    title: "Calidad y regulatorio · requisitos de etiqueta",
    description: "Todo lo legal que debe llevar la etiqueta: denominación, contenido, idiomas, iconos, INCI, modo de uso, precauciones, responsable, UFI y lote.",
    dept: "calidad",
    phase: 3,
    groups: [
      {
        title: "Denominación y contenido",
        fields: [
          { key: "denomination", label: "Denominación del producto", type: "select", options: DENOMINATIONS, required: true },
          { key: "denominationOther", label: "Otra denominación", type: "text", requiredIf: is("denomination", "otro") },
          { key: "nominalMl", label: "Cantidad", type: "number", unit: "ml", required: true },
          { key: "nominalFlOz", label: "Cantidad en fl oz", type: "number", unit: "fl oz", hint: "Precalculado desde los ml (1 fl oz = 29,57 ml)." },
          { key: "estimated", label: "Lleva el símbolo ℮ (cantidad estimada)", type: "bool" },
        ],
      },
      {
        title: "Idiomas",
        fields: [
          { key: "languages", label: "Idiomas de la etiqueta", type: "multi", options: LANGUAGES, required: true, hint: "Precargados según los mercados del brief." },
          { key: "languagesOther", label: "Otros idiomas", type: "text" },
        ],
      },
      {
        title: "Iconos",
        fields: [
          { key: "recyclingIcons", label: "Iconos de reciclaje", type: "multi", options: RECYCLING_ICONS, required: true },
          { key: "recyclingOther", label: "Otros iconos de reciclaje", type: "text", requiredIf: has("recyclingIcons", "otros") },
          { key: "hazardIcons", label: "Iconos de peligro", type: "multi", options: HAZARD_ICONS, required: true },
          { key: "hazardOther", label: "Otros iconos de peligro", type: "text", requiredIf: has("hazardIcons", "otros") },
          { key: "otherIcons", label: "Otros iconos / símbolos", type: "multi", options: OTHER_ICONS },
          { key: "otherIconsText", label: "Otros símbolos", type: "text", requiredIf: has("otherIcons", "otros") },
          { key: "pao", label: "PAO / duración", type: "text", placeholder: "p. ej. 24M", requiredIf: has("otherIcons", "pao") },
        ],
      },
      {
        title: "Composición y textos",
        fields: [
          { key: "inci", label: "INCI / ingredientes", type: "textarea", required: true, placeholder: "ALCOHOL DENAT., PARFUM (FRAGRANCE), AQUA (WATER)…" },
          { key: "allergens", label: "Alérgenos a declarar", type: "textarea" },
          { key: "usage", label: "Modo de uso", type: "textarea", required: true },
          { key: "warnings", label: "Precauciones", type: "textarea", required: true, placeholder: "Advertencias y frases H/P que deben figurar" },
        ],
      },
      {
        title: "Responsable",
        fields: [
          {
            key: "responsibleRole",
            label: "Figura",
            type: "select",
            required: true,
            options: opts([
              ["fabricante", "Fabricante"],
              ["distribuidor", "Distribuidor"],
              ["importador", "Importador"],
              ["responsable", "Responsable del producto"],
            ]),
          },
          { key: "responsibleName", label: "Nombre", type: "text", required: true },
          { key: "responsibleAddress", label: "Dirección", type: "text", required: true },
          { key: "responsibleCountry", label: "País", type: "text", required: true },
          { key: "responsibleContact", label: "Web o teléfono", type: "text" },
        ],
      },
      {
        title: "Códigos",
        fields: [
          {
            key: "ufiStatus",
            label: "UFI",
            type: "select",
            required: true,
            options: opts([
              ["na", "No aplica"],
              ["pendiente", "Pendiente"],
              ["disponible", "Disponible"],
            ]),
          },
          { key: "ufi", label: "Código UFI", type: "text", requiredIf: is("ufiStatus", "disponible") },
          { key: "lot", label: "Lote (formato y ubicación del marcaje)", type: "text", required: true, placeholder: "p. ej. «L» + 6 dígitos, en la base" },
          { key: "cpnp", label: "Nº de notificación CPNP", type: "text" },
        ],
      },
      { fields: [{ key: "regFiles", label: "Documentación (IFRA, FDS, CPSR, certificados)", type: "files", tag: "regulatorio" }] },
    ],
    prefill: (c) => {
      const ml = c.brief.capacityMl ?? undefined;
      const languages = [...new Set((c.brief.markets ?? []).flatMap((m) => LANGUAGES_FROM_MARKET[m] ?? []))];
      return {
        denomination: c.brief.format ? DENOMINATION_FROM_FORMAT[c.brief.format] : undefined,
        nominalMl: ml,
        nominalFlOz: ml ? Math.round((ml / 29.5735) * 10) / 10 : undefined,
        languages: languages.length ? languages : undefined,
      };
    },
  },
  {
    key: "etiqueta",
    title: "Etiqueta y artes finales",
    description: "Troquel, detalles de la etiqueta y artes finales aprobados por el cliente.",
    dept: "diseno",
    phase: 4,
    dependsOn: ["identificacion", "regulatorio", "formula", "packaging"],
    groups: [
      {
        title: "Troquel",
        fields: [
          {
            key: "dieType",
            label: "Troquel",
            type: "select",
            required: true,
            options: opts([
              ["existente", "Troquel existente"],
              ["nuevo", "Nuevo troquel"],
            ]),
          },
          { key: "dieRef", label: "Referencia / código de troquel", type: "text", requiredIf: is("dieType", "existente") },
          { key: "dieSize", label: "Medidas", type: "text", requiredIf: is("dieType", "nuevo") },
          { key: "dieSupplier", label: "Proveedor", type: "text" },
          {
            key: "dieFile",
            label: "Archivo del troquel disponible",
            type: "select",
            options: opts([
              ["si", "Sí"],
              ["no", "No"],
            ]),
          },
        ],
      },
      {
        title: "Etiqueta",
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
          { key: "texts", label: "Textos adicionales", type: "textarea", placeholder: "Claims, textos de marketing… (los legales vienen de Calidad y regulatorio)" },
        ],
      },
      {
        title: "Artes finales",
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
    if (f.required || f.requiredIf?.(data)) {
      const filled = isScalarFilled(f, data[f.key]);
      const valid = !filled || !f.valid || f.valid(data[f.key], data);
      out.push({ label: valid ? f.label : (f.invalidLabel ?? `${f.label} (no válido)`), ok: filled && valid });
    }
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

/** Resumen legible de lo rellenado en un apartado (emails a los departamentos siguientes). */
export function summarize(s: SheetSection, c: SheetCtx, data: SheetData): string[] {
  const out: string[] = [];
  for (const f of allFields(s, c)) {
    if (f.type === "files") {
      const n = c.filesByTag[f.tag] ?? 0;
      if (n) out.push(`${f.label}: ${n} archivo${n === 1 ? "" : "s"}`);
      continue;
    }
    if (f.type === "list") {
      const items = (Array.isArray(data[f.key]) ? data[f.key] : []) as SheetData[];
      for (const it of items) {
        const parts = applicable(f.item, c)
          .filter((x) => x.key !== "name")
          .map((x) => {
            const v = formatValue(x, it[x.key]);
            return v ? `${x.label}: ${v}` : null;
          })
          .filter(Boolean);
        out.push(`${String(it.name ?? f.itemLabel)} — ${parts.join("; ")}`);
      }
      continue;
    }
    const v = formatValue(f, data[f.key]);
    if (v && !(f.type === "bool" && v === "No")) out.push(`${f.label}: ${v}`);
  }
  return out;
}
