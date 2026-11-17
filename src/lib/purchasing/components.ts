/** Componentes que Compras puede añadir al desglose de un proyecto. Módulo puro (cliente y servidor). */
export const COMPONENTS = [
  { key: "frasco", label: "Frasco" },
  { key: "tapon", label: "Tapón" },
  { key: "valvula", label: "Válvula" },
  { key: "anilla", label: "Anilla" },
  { key: "varillas", label: "Varillas (mikado)" },
  { key: "flor", label: "Flor (mikado)" },
  { key: "etiqueta", label: "Etiqueta" },
  { key: "etiqueta_base", label: "Etiqueta base" },
  { key: "estuche", label: "Estuche" },
  { key: "caja_logistica", label: "Caja logística" },
  { key: "caja_expositora", label: "Caja expositora" },
] as const;

export type ComponentKey = (typeof COMPONENTS)[number]["key"];
export const COMPONENT_KEYS = COMPONENTS.map((c) => c.key) as [ComponentKey, ...ComponentKey[]];
export const COMPONENT_LABEL: Record<string, string> = Object.fromEntries(COMPONENTS.map((c) => [c.key, c.label]));

/** Proveedores por componente. */
export const MAX_SUPPLIERS = 3;

/** Las varillas y la flor solo tienen sentido en un mikado. */
export const isMikadoOnly = (key: string) => key === "varillas" || key === "flor";

export const COMPONENT_QUOTE_STATUS: Record<string, string> = { pending: "Sin pedir", requested: "Pedida", received: "Recibida" };

export const componentLabel = (c: { component: string; description?: string | null }) =>
  `${COMPONENT_LABEL[c.component] ?? c.component}${c.description ? ` (${c.description})` : ""}`;
