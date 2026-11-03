/**
 * Ficha técnica del proyecto: apartados con la información que aporta cada
 * departamento conforme avanza el proyecto. Módulo puro (cliente y servidor).
 *
 * - Cada apartado pertenece a un departamento (por clave; reasignable en el
 *   backoffice) y a la fase en la que se trabaja.
 * - Los campos son opcionales: el avance lo marcan los subestados del
 *   departamento. Solo bloquean los campos que el backoffice exija para entrar
 *   en un subestado concreto (`dept_substates.required_fields`, «apartado.campo»).
 */

export type Opt = { value: string; label: string };

type Base = {
  key: string;
  label: string;
  /** Validación adicional del valor (p. ej. longitud del código de barras). */
  valid?: (v: unknown, d: SheetData) => boolean;
  invalidLabel?: string;
  hint?: string;
  when?: (c: SheetCtx) => boolean;
};
export type ScalarField =
  | (Base & { type: "text" | "textarea" | "url"; placeholder?: string })
  | (Base & { type: "money" | "number"; unit?: string })
  | (Base & { type: "date" })
  | (Base & { type: "bool" })
  | (Base & { type: "select" | "multi"; options: Opt[] });
export type SheetField = ScalarField | (Base & { type: "files"; tag: string });

export type SheetGroup = { title?: string; fields: SheetField[] };

export type SheetSection = {
  key: string;
  title: string;
  description: string;
  /** Departamento por defecto (clave de `departments.key`). */
  dept: string;
  /** Fase en la que se trabaja. */
  phase: number;
  groups: SheetGroup[];
  prefill?: (c: SheetCtx) => Record<string, unknown>;
  /** Apartados cuya información necesita este (se le envía al abrirse su fase). */
  dependsOn?: string[];
  /** Fase hasta la que puede seguir trabajando: no bloquea el avance de fases anteriores (por defecto, su propia fase). */
  dueBy?: number;
};

/** Contexto del proyecto necesario para evaluar la ficha. */
export type SheetCtx = {
  olfactory: boolean;
  brief: {
    name?: string | null;
    format?: string | null;
    markets?: string[];
    targetPrice?: number | null;
    rrp?: number | null;
    unitsFirstOrder?: number | null;
    capacityMl?: number | null;
    references?: number | null;
    finalName?: string | null;
    languages?: string[];
  };
  filesByTag: Record<string, number>;
};

export type SheetData = Record<string, unknown>;

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

const digits = (n: number) => (v: unknown) => typeof v === "string" && new RegExp(`^\\d{${n}}$`).test(v.replace(/\s/g, ""));

export const SHEET_SECTIONS: SheetSection[] = [
  {
    key: "comercial",
    title: "Cotización y condiciones comerciales",
    description: "Precios cotizados y acordados con el cliente.",
    dept: "comercial",
    phase: 1,
    groups: [
      {
        title: "Precios",
        fields: [
          { key: "unitPrice", label: "Precio unitario cotizado", type: "money", unit: "€/ud" },
          { key: "finalUnitPrice", label: "Precio unitario final", type: "money", unit: "€/ud", hint: "El acordado con el cliente al aprobar el presupuesto." },
          { key: "targetPrice", label: "Precio objetivo inicial", type: "money", unit: "€/ud", hint: "El que pidió el cliente en la solicitud (se precarga del brief)." },
          { key: "rrp", label: "PVP recomendado", type: "money", unit: "€" },
          { key: "units", label: "Unidades del primer pedido", type: "number", unit: "uds" },
          { key: "conditions", label: "Condiciones", type: "textarea", placeholder: "Plazos de entrega, forma de pago, portes, validez de la oferta…" },
        ],
      },
    ],
    prefill: (c) => ({ targetPrice: c.brief.targetPrice ?? undefined, rrp: c.brief.rrp ?? undefined, units: c.brief.unitsFirstOrder ?? undefined }),
  },
  {
    key: "formula",
    title: "Fórmula",
    description: "Referencia desarrollada por el laboratorio y aprobada por el cliente.",
    dept: "idi",
    phase: 3,
    groups: [{ fields: [{ key: "approvedReference", label: "Referencia aprobada", type: "text", placeholder: "Nombre o código de la referencia aprobada" }] }],
  },
  {
    key: "packaging",
    title: "Envase y packaging",
    description: "Frasco, tapón y packaging secundario seleccionados para el proyecto.",
    dept: "marketing",
    phase: 3,
    groups: [
      {
        title: "Envase",
        fields: [
          { key: "bottleModel", label: "Modelo", type: "text" },
          { key: "bottleSupplier", label: "Proveedor", type: "text" },
          { key: "bottleCapacity", label: "Capacidad", type: "number", unit: "ml" },
          { key: "bottleFinish", label: "Material, color y acabado", type: "text" },
        ],
      },
      {
        title: "Tapón y cierre",
        fields: [
          { key: "capModel", label: "Tapón", type: "text" },
          { key: "capSupplier", label: "Proveedor", type: "text" },
          { key: "capFinish", label: "Material, color y acabado", type: "text" },
          { key: "pump", label: "Bomba / válvula / difusor", type: "text" },
        ],
      },
      {
        title: "Etiqueta",
        fields: [
          {
            key: "labelPrint",
            label: "Tipo de impresión",
            type: "multi",
            options: opts([
              ["digital", "Digital"],
              ["offset", "Offset"],
              ["flexo", "Flexografía"],
              ["serigrafia", "Serigrafía"],
              ["stamping", "Stamping"],
              ["relieve", "Relieve / gofrado"],
              ["barniz", "Barniz UVI / selectivo"],
            ]),
          },
          { key: "labelMaterial", label: "Material y acabado", type: "text", placeholder: "Papel verjurado, PP transparente, metalizado…" },
          { key: "labelDetail", label: "Medidas y otros detalles", type: "text" },
        ],
      },
      {
        title: "Estuche",
        fields: [
          {
            key: "secondaryType",
            label: "Tipo",
            type: "select",
            options: [
              { value: "estuche", label: "Estuche" },
              { value: "caja", label: "Caja / cofre" },
              { value: "blister", label: "Blíster" },
              { value: "sin", label: "Sin packaging secundario" },
            ],
          },
          { key: "boxBoard", label: "Cartón y gramaje", type: "text", placeholder: "p. ej. Folding 350 g" },
          {
            key: "boxPrint",
            label: "Impresión y acabados",
            type: "multi",
            options: opts([
              ["cmyk", "CMYK"],
              ["pantones", "Pantones"],
              ["stamping", "Stamping"],
              ["relieve", "Relieve / gofrado"],
              ["barniz", "Barniz UVI / selectivo"],
              ["laminado", "Laminado / plastificado"],
            ]),
          },
          { key: "pantones", label: "Pantones / colores", type: "text" },
          { key: "secondaryDetail", label: "Medidas y otros detalles", type: "textarea" },
        ],
      },
      {
        title: "Caja master",
        fields: [
          { key: "masterUnits", label: "Unidades por caja", type: "number", unit: "uds" },
          { key: "masterDetail", label: "Tipo, medidas y marcaje", type: "text", placeholder: "Canal simple, 30×20×25 cm, etiqueta con EAN y lote…" },
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
          { key: "productName", label: "Nombre comercial (naming)", type: "text", hint: "Naming del producto con el que se venderá. Se precarga con el naming definitivo que aporta el comercial." },
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
            // Si lleva EAN, el código debe estar completo (al exigir el tipo para validar)
            valid: (v, d) => v === "no" || (v === "ean8" ? digits(8)(d.barcode) : digits(13)(d.barcode)),
            invalidLabel: "Código de barras (13 dígitos en EAN-13, 8 en EAN-8)",
            options: opts([
              ["ean13", "EAN-13"],
              ["ean8", "EAN-8"],
              ["no", "No lleva"],
            ]),
          },
          {
            key: "barcode",
            label: "Código de barras",
            type: "text",
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
            valid: (v, d) => v !== "si" || (typeof d.qrContent === "string" && d.qrContent.trim().length > 0),
            invalidLabel: "Destino del QR",
            options: opts([
              ["no", "No"],
              ["si", "Sí"],
            ]),
          },
          { key: "qrContent", label: "Destino del QR (URL o contenido)", type: "text" },
        ],
      },
    ],
    // Solo el naming definitivo del comercial: el nombre del proyecto es provisional y no es el naming
    prefill: (c) => ({ productName: c.brief.finalName ?? undefined }),
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
          { key: "denomination", label: "Denominación del producto", type: "select", options: DENOMINATIONS },
          { key: "denominationOther", label: "Otra denominación", type: "text" },
          { key: "nominalMl", label: "Cantidad", type: "number", unit: "ml" },
          { key: "nominalFlOz", label: "Cantidad en fl oz", type: "number", unit: "fl oz", hint: "Precalculado desde los ml (1 fl oz = 29,57 ml)." },
          { key: "estimated", label: "Lleva el símbolo ℮ (cantidad estimada)", type: "bool" },
        ],
      },
      {
        title: "Idiomas",
        fields: [
          { key: "languages", label: "Idiomas de la etiqueta", type: "multi", options: LANGUAGES, hint: "Precargados según los mercados del brief." },
          { key: "languagesOther", label: "Otros idiomas", type: "text" },
        ],
      },
      {
        title: "Iconos",
        fields: [
          { key: "recyclingIcons", label: "Iconos de reciclaje", type: "multi", options: RECYCLING_ICONS },
          { key: "recyclingOther", label: "Otros iconos de reciclaje", type: "text" },
          { key: "hazardIcons", label: "Iconos de peligro", type: "multi", options: HAZARD_ICONS },
          { key: "hazardOther", label: "Otros iconos de peligro", type: "text" },
          { key: "otherIcons", label: "Otros iconos / símbolos", type: "multi", options: OTHER_ICONS },
          { key: "otherIconsText", label: "Otros símbolos", type: "text" },
          { key: "pao", label: "PAO / duración", type: "text", placeholder: "p. ej. 24M" },
        ],
      },
      {
        title: "Composición y textos",
        fields: [
          { key: "inci", label: "INCI / ingredientes", type: "textarea", placeholder: "ALCOHOL DENAT., PARFUM (FRAGRANCE), AQUA (WATER)…" },
          { key: "allergens", label: "Alérgenos a declarar", type: "textarea" },
          { key: "usage", label: "Modo de uso", type: "textarea" },
          { key: "warnings", label: "Precauciones", type: "textarea", placeholder: "Advertencias y frases H/P que deben figurar" },
        ],
      },
      {
        title: "Responsable",
        fields: [
          {
            key: "responsibleRole",
            label: "Figura",
            type: "select",
            options: opts([
              ["fabricante", "Fabricante"],
              ["distribuidor", "Distribuidor"],
              ["importador", "Importador"],
              ["responsable", "Responsable del producto"],
            ]),
          },
          { key: "responsibleName", label: "Nombre", type: "text" },
          { key: "responsibleAddress", label: "Dirección", type: "text" },
          { key: "responsibleCountry", label: "País", type: "text" },
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
            options: opts([
              ["na", "No aplica"],
              ["pendiente", "Pendiente"],
              ["disponible", "Disponible"],
            ]),
          },
          { key: "ufi", label: "Código UFI", type: "text" },
          { key: "lot", label: "Lote (formato y ubicación del marcaje)", type: "text", placeholder: "p. ej. «L» + 6 dígitos, en la base" },
          { key: "cpnp", label: "Nº de notificación CPNP", type: "text" },
        ],
      },
      { fields: [{ key: "regFiles", label: "Documentación (IFRA, FDS, CPSR, certificados)", type: "files", tag: "regulatorio" }] },
    ],
    prefill: (c) => {
      const ml = c.brief.capacityMl ?? undefined;
      // Idiomas indicados por el comercial; si no, los que corresponden a los países de venta
      const languages = c.brief.languages?.length
        ? c.brief.languages
        : [...new Set((c.brief.markets ?? []).flatMap((m) => LANGUAGES_FROM_MARKET[m] ?? []))];
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
            options: opts([
              ["existente", "Troquel existente"],
              ["nuevo", "Nuevo troquel"],
            ]),
          },
          { key: "dieRef", label: "Referencia / código de troquel", type: "text" },
          { key: "dieSize", label: "Medidas", type: "text" },
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
          {
            key: "artworkUrl",
            label: "Enlace a los artes finales",
            type: "url",
            placeholder: "https://natuaromatic.sharepoint.com/…",
            hint: "Pega el enlace de la carpeta o del archivo en OneDrive o SharePoint (con permiso para el equipo).",
            valid: (v) => typeof v === "string" && /^https:\/\/[^\s]+\.(sharepoint\.com|onedrive\.live\.com|1drv\.ms)(\/|$)/i.test(v),
            invalidLabel: "un enlace de OneDrive o SharePoint",
          },
          { key: "clientApproved", label: "Artes finales aprobados por el cliente", type: "bool" },
          { key: "clientApprovedAt", label: "Fecha de aprobación", type: "date" },
        ],
      },
    ],
  },
  {
    key: "aprovisionamiento",
    title: "Aprovisionamiento",
    description: "Compra de frascos, tapones, válvulas, etiquetas, estuches y cajas master para el proyecto.",
    dept: "compras",
    phase: 3,
    // Empieza con Laboratorio pero solo hace falta terminar antes de pasar a producción
    dueBy: 5,
    dependsOn: ["packaging", "comercial"],
    groups: [
      {
        title: "Pedidos de materiales",
        fields: [
          { key: "suppliersLeadTimes", label: "Proveedores y plazos por componente", type: "textarea", placeholder: "Frasco: proveedor, plazo… · Tapón: … · Etiqueta: … · Estuche: … · Caja master: …" },
          { key: "ordersPlaced", label: "Pedidos lanzados", type: "bool" },
          { key: "orderDate", label: "Fecha de pedido", type: "date" },
          { key: "expectedArrival", label: "Llegada prevista de materiales", type: "date" },
          { key: "materialsReceived", label: "Materiales recibidos", type: "bool" },
          { key: "notes", label: "Notas", type: "textarea" },
        ],
      },
      { fields: [{ key: "purchaseFiles", label: "Pedidos y confirmaciones de proveedores", type: "files", tag: "compras" }] },
    ],
  },
  {
    key: "produccion",
    title: "Preparación para producción",
    description: "Escandallo final, lote piloto y fecha prevista de fabricación.",
    dept: "operaciones",
    phase: 5,
    groups: [
      {
        fields: [
          { key: "productionDate", label: "Fecha prevista de producción", type: "date" },
          { key: "pilotApproved", label: "Lote piloto validado", type: "bool" },
          { key: "costFiles", label: "Escandallo final", type: "files", tag: "escandallo" },
          { key: "notes", label: "Notas", type: "textarea" },
        ],
      },
    ],
  },
];

export const SECTION_BY_KEY: Record<string, SheetSection> = Object.fromEntries(SHEET_SECTIONS.map((s) => [s.key, s]));

/**
 * Con varias referencias, estos apartados van siempre por referencia (fórmula,
 * naming y EAN, regulatorio, etiqueta). «Envase y packaging» puede ser común o
 * por referencia, y el precio de la cotización único o por referencia.
 */
export const PER_REFERENCE_SECTIONS = new Set(["formula", "identificacion", "regulatorio", "etiqueta"]);
export const PER_REFERENCE_PRICE_FIELDS = ["unitPrice", "finalUnitPrice"] as const;

export function isPerReferenceSection(key: string, multi: boolean, packagingMode: string) {
  return multi && (PER_REFERENCE_SECTIONS.has(key) || (key === "packaging" && packagingMode === "per_reference"));
}

/** Etiqueta de un campo con el grupo delante si hace falta para entenderlo («Envase · Modelo»). */
export function fieldLabelInSection(section: SheetSection, fieldKey: string) {
  const g = section.groups.find((x) => x.fields.some((f) => f.key === fieldKey));
  const f = g?.fields.find((x) => x.key === fieldKey);
  if (!f) return fieldKey;
  return g?.title && section.groups.filter((x) => x.title).length > 1 ? `${g.title} · ${f.label}` : f.label;
}

/**
 * Especificaciones que se cotizan (envase/tapón, etiqueta, estuche, caja master):
 * se piden al enviar la cotización y quedan en «Envase y packaging» de Marketing.
 * Los proveedores son internos y no se incluyen.
 */
export function quoteSpecGroups() {
  return SECTION_BY_KEY.packaging!.groups
    .map((g) => ({ title: g.title ?? "", fields: g.fields.filter((f): f is ScalarField => f.type !== "files" && !/Supplier$/.test(f.key)) }))
    .filter((g) => g.fields.length);
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
      return Array.isArray(v) && v.length > 0;
    default:
      return typeof v === "string" && v.trim() !== "";
  }
}

/** Campos de datos (no archivos) de un apartado. */
export function scalarFields(s: SheetSection): ScalarField[] {
  return s.groups.flatMap((g) => g.fields).filter((f): f is ScalarField => f.type !== "files");
}

/** Referencia «apartado.campo» → definición (para los campos exigidos o pedidos por un subestado). */
export function resolveFieldRef(ref: string): { section: SheetSection; field: ScalarField } | null {
  const [sectionKey, fieldKey] = ref.split(".");
  const section = SECTION_BY_KEY[sectionKey ?? ""];
  const field = section && scalarFields(section).find((f) => f.key === fieldKey);
  return section && field ? { section, field } : null;
}

/** ¿El campo tiene un valor válido? Devuelve la etiqueta a mostrar si falta o no es válido. */
export function checkField(f: ScalarField, data: SheetData): { ok: boolean; label: string } {
  const v = data[f.key];
  if (!isScalarFilled(f, v)) return { ok: false, label: f.label };
  if (f.valid && !f.valid(v, data)) return { ok: false, label: f.invalidLabel ?? `${f.label} (no válido)` };
  return { ok: true, label: f.label };
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
      case "url": {
        // Solo enlaces https (se muestran como enlace: nada de javascript: ni similares)
        const t = typeof v === "string" ? v.trim() : "";
        return /^https:\/\/[^\s]+$/i.test(t) ? t.slice(0, 2000) : undefined;
      }
      default:
        return typeof v === "string" && v.trim() ? v.trim().slice(0, f.type === "textarea" ? 8000 : 300) : undefined;
    }
  };
  for (const f of s.groups.flatMap((g) => g.fields)) {
    if (f.type === "files") continue;
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
    default:
      return String(v);
  }
}

/** Resumen legible de lo rellenado en un apartado (emails a los departamentos siguientes). */
export function summarize(s: SheetSection, c: SheetCtx, data: SheetData): string[] {
  const out: string[] = [];
  // Con varios grupos titulados (Envase, Tapón, Etiqueta…) se antepone el grupo para que se entienda
  const titled = s.groups.filter((g) => g.title).length > 1;
  for (const g of s.groups) {
    const prefix = titled && g.title ? `${g.title} · ` : "";
    for (const f of applicable(g.fields, c)) {
      if (f.type === "files") {
        const n = c.filesByTag[f.tag] ?? 0;
        if (n) out.push(`${prefix}${f.label}: ${n} archivo${n === 1 ? "" : "s"}`);
        continue;
      }
      const v = formatValue(f, data[f.key]);
      if (v && !(f.type === "bool" && v === "No")) out.push(`${prefix}${f.label}: ${v}`);
    }
  }
  return out;
}
