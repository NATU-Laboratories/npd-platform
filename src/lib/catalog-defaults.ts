/**
 * Valores iniciales de los catálogos (seed). Editables después desde el
 * backoffice (tabla catalog_items). La clave es catalog_items.type.
 */
export const CATALOG_TYPES = {
  needed_by_reason: "Motivos de la fecha",
  pl_subtype: "Subtipos PL",
  mp_origin: "Orígenes (marca propia)",
  channel: "Canales",
  market: "Mercados",
  language: "Idiomas de etiquetado",
  format_perfume: "Formatos · Perfumería",
  format_ambient: "Formatos · Ambientación",
  format_cosmetic: "Formatos · Personal Care",
  cosmetic_function: "Funciones / claims Personal Care",
  olfactory_family: "Familias olfativas",
  note: "Notas olfativas",
  seasonality: "Estacionalidad",
  certification: "Certificaciones",
  rejection_reason: "Motivos de rechazo",
} as const;

export type CatalogType = keyof typeof CATALOG_TYPES;

/** Para selects cuyo valor tiene lógica asociada usamos "valor|Etiqueta". */
export const CATALOG_DEFAULTS: Record<CatalogType, string[]> = {
  needed_by_reason: [
    "feria|Feria",
    "lanzamiento_cliente|Lanzamiento del cliente",
    "temporada|Temporada",
    "licitacion|Licitación",
    "orientativa|Orientativa",
    "otro|Otro",
  ],
  pl_subtype: [
    "desarrollo_completo|Desarrollo completo",
    "formula_catalogo|Fórmula de catálogo NATU",
    "replica|Réplica de producto existente del cliente",
    "extension_gama|Extensión de gama",
    "cambio_packaging|Solo cambio de packaging",
  ],
  mp_origin: [
    "peticion_cliente|Petición de cliente/retailer",
    "marketing|Iniciativa de Marketing",
    "direccion|Dirección",
    "tendencia|Tendencia detectada",
    "hueco_gama|Hueco en gama",
    "otro|Otro",
  ],
  channel: [
    "gran_distribucion|Gran distribución",
    "perfumeria|Perfumería",
    "farmacia|Farmacia / parafarmacia",
    "online|Online",
    "otro|Otro",
  ],
  market: [
    "ES|España",
    "PT|Portugal",
    "FR|Francia",
    "IT|Italia",
    "DE|Alemania",
    "RO|Rumanía",
    "GB|Reino Unido",
    "NL|Países Bajos",
    "BE|Bélgica",
    "PL|Polonia",
    "GR|Grecia",
    "US|Estados Unidos",
    "MX|México",
    "MA|Marruecos",
    "AE|Emiratos Árabes",
    "SA|Arabia Saudí",
  ],
  language: ["es|Español", "pt|Portugués", "fr|Francés", "it|Italiano", "en|Inglés", "de|Alemán", "ro|Rumano", "ar|Árabe", "nl|Neerlandés", "pl|Polaco", "el|Griego"],
  format_perfume: ["edt|EDT", "edp|EDP", "body_mist|Body mist", "colonia|Colonia", "colonia_infantil|Colonia infantil", "extracto|Extracto", "otro|Otro"],
  format_ambient: [
    "mikado|Mikado",
    "spray|Spray",
    "vela|Vela",
    "recambio_electrico|Recambio eléctrico",
    "coche|Ambientador de coche",
    "sachet|Sachet",
    "textil|Textil",
    "otro|Otro",
  ],
  format_cosmetic: ["crema|Crema", "gel|Gel", "champu|Champú", "body_lotion|Body lotion", "desodorante|Desodorante", "aceite|Aceite", "otro|Otro"],
  cosmetic_function: ["Hidratante", "Nutritiva", "Calmante", "Reafirmante", "Antiedad", "Purificante", "Protectora", "Refrescante", "Suavizante", "Desodorante 48h"],
  olfactory_family: [
    "Floral",
    "Frutal",
    "Cítrico",
    "Amaderado",
    "Oriental / ámbar",
    "Aromático",
    "Fougère",
    "Chipre",
    "Gourmand",
    "Acuático",
    "Verde",
    "Almizclado",
    "Especiado",
    "Cuero",
  ],
  note: [
    "Bergamota", "Limón", "Mandarina", "Naranja", "Pomelo", "Neroli", "Petitgrain", "Menta", "Lavanda", "Romero",
    "Pimienta rosa", "Cardamomo", "Jengibre", "Manzana", "Pera", "Frambuesa", "Grosella negra", "Melocotón", "Coco", "Piña",
    "Rosa", "Jazmín", "Azahar", "Tuberosa", "Peonía", "Lirio", "Violeta", "Magnolia", "Fresia", "Ylang-ylang",
    "Muguet", "Té verde", "Higo", "Canela", "Clavo", "Vainilla", "Haba tonka", "Caramelo", "Praliné", "Cacao",
    "Café", "Sándalo", "Cedro", "Vetiver", "Pachulí", "Oud", "Musgo de roble", "Ámbar", "Almizcle blanco", "Incienso",
    "Cuero", "Benjuí", "Brisa marina", "Algodón", "Talco",
  ],
  seasonality: ["Primavera", "Verano", "Otoño", "Invierno", "Navidad", "Todo el año"],
  certification: ["Vegano", "Cruelty free", "COSMOS / Ecocert", "Natrue", "Halal", "IFRA conforme"],
  rejection_reason: [
    "no_viable|No viable técnicamente",
    "precio|Precio",
    "volumen|Volumen insuficiente",
    "estrategia|Fuera de estrategia",
    "duplicado|Duplicado",
    "otro|Otro",
  ],
};

export type Option = { value: string; label: string };

export function parseCatalogValue(raw: string): Option {
  const i = raw.indexOf("|");
  return i === -1 ? { value: raw, label: raw } : { value: raw.slice(0, i), label: raw.slice(i + 1) };
}

export const BRAND_DEFAULTS = ["NATU", "BetrésON", "SevenKIDS", "Delisea"];

export const DEPARTMENT_DEFAULTS: { key: string; name: string; color: string }[] = [
  { key: "marketing", name: "Marketing / NPD", color: "#0f766e" },
  { key: "idi", name: "Laboratorio / I+D", color: "#7c3aed" },
  { key: "calidad", name: "Calidad y Regulatory", color: "#0284c7" },
  { key: "diseno", name: "Diseño", color: "#db2777" },
  { key: "comunicacion", name: "Comunicación", color: "#ea580c" },
  { key: "operaciones", name: "Operaciones", color: "#65a30d" },
  { key: "compras", name: "Compras / Aprovisionamiento", color: "#ca8a04" },
  { key: "produccion", name: "Producción", color: "#475569" },
  { key: "almacen", name: "Almacén", color: "#78716c" },
  { key: "comercial", name: "Comercial", color: "#2563eb" },
  { key: "direccion", name: "Dirección", color: "#111827" },
];

export const SETTINGS_DEFAULTS = {
  completeness_threshold: 60,
  risk_days: 30,
  max_file_mb: 50,
  sender_mailbox: "",
  requesters_see_all: false,
  /** Reasignación de apartados de la ficha técnica a departamentos: { apartado: clave de departamento }. */
  sheet_departments: {} as Record<string, string>,
};

export type AppSettings = {
  completeness_threshold: number;
  risk_days: number;
  max_file_mb: number;
  sender_mailbox: string;
  requesters_see_all: boolean;
  sheet_departments: Record<string, string>;
};

/**
 * Subestados iniciales de cada departamento (editables en el backoffice).
 * `returns`: subestados a los que se puede volver desde este.
 * `prompt` / `required`: campos de la ficha («apartado.campo») que se piden / exigen al entrar.
 */
export const SUBSTATE_DEFAULTS: Record<string, { name: string; final?: boolean; returns?: string[]; prompt?: string[]; required?: string[] }[]> = {
  comercial: [
    { name: "Pendiente de cotizar" },
    { name: "Cotización enviada", returns: ["Pendiente de cotizar"] },
    { name: "Negociación con el cliente", returns: ["Cotización enviada"] },
    { name: "Presupuesto aprobado", final: true, returns: ["Negociación con el cliente"], prompt: ["comercial.finalUnitPrice"] },
  ],
  idi: [
    { name: "Pendiente" },
    { name: "Desarrollo de muestras" },
    { name: "Muestras en evaluación", returns: ["Desarrollo de muestras"] },
    { name: "Referencia aprobada", final: true, returns: ["Desarrollo de muestras"], prompt: ["formula.approvedReference"] },
  ],
  marketing: [
    { name: "Pendiente" },
    { name: "Envase y packaging" },
    { name: "Naming y códigos", returns: ["Envase y packaging"] },
    { name: "Validado", final: true, returns: ["Envase y packaging", "Naming y códigos"] },
  ],
  calidad: [
    { name: "Pendiente" },
    { name: "Revisión de fórmula y documentación" },
    { name: "Textos legales de etiqueta", returns: ["Revisión de fórmula y documentación"] },
    { name: "Validado", final: true, returns: ["Textos legales de etiqueta"] },
  ],
  diseno: [
    { name: "Pendiente" },
    { name: "Diseño en curso" },
    { name: "En revisión", returns: ["Diseño en curso"] },
    { name: "Artes finales aprobadas", final: true, returns: ["Diseño en curso"] },
  ],
  operaciones: [
    { name: "Pendiente" },
    { name: "Compras lanzadas" },
    { name: "Planificación de producción", returns: ["Compras lanzadas"] },
    { name: "Listo para producir", final: true, returns: ["Planificación de producción"] },
  ],
};
