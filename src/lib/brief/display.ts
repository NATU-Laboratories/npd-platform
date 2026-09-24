import { CATEGORY_LABEL, PRIORITY_LABEL, TYPE_LABEL } from "@/lib/labels";
import { needsOlfactory, type BriefData } from "./schema";

export type Lookups = {
  catalog: Record<string, Record<string, string>>;
  brands: Record<number, string>;
  users: Record<string, string>;
  clients: Record<number, string>;
};

export const GENDER_LABEL = { mujer: "Mujer", hombre: "Hombre", unisex: "Unisex" } as const;

const SUPPLIER_LABEL = { cliente: "Cliente", natu: "NATU", mixto: "Mixto" } as const;

export type Row = [label: string, value: string | null];
export type Section = { title: string; step: number; rows: Row[] };

function list(v: string[] | undefined, map?: Record<string, string>) {
  if (!v?.length) return null;
  return v.map((x) => map?.[x] ?? x).join(", ");
}

function num(v: number | undefined, suffix = "") {
  return v == null ? null : `${v.toLocaleString("es-ES")}${suffix}`;
}

function eur(v: number | undefined) {
  return v == null ? null : v.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

export function formatFormat(b: BriefData, l: Lookups) {
  if (!b.format) return null;
  const type = b.category ? `format_${b.category}` : "";
  const f = b.format === "otro" && b.formatOther ? b.formatOther : (l.catalog[type]?.[b.format] ?? b.format);
  return f;
}

/** Secciones legibles del brief (resumen del asistente y ficha del proyecto). */
export function briefSections(b: BriefData, l: Lookups): Section[] {
  const c = l.catalog;
  const reason = b.neededByReason ? (c.needed_by_reason?.[b.neededByReason] ?? b.neededByReason) : null;
  const sections: Section[] = [
    {
      title: "Datos básicos",
      step: 1,
      rows: [
        ["Tipo de proyecto", b.type ? TYPE_LABEL[b.type] : null],
        ["Categoría", b.category ? CATEGORY_LABEL[b.category] : null],
        ["Nombre provisional", b.name ?? null],
        ["Fecha necesaria", b.neededBy ? new Date(`${b.neededBy}T00:00:00`).toLocaleDateString("es-ES") : null],
        ["Motivo de la fecha", [reason, b.neededByReasonText].filter(Boolean).join(" — ") || null],
        ["Prioridad sugerida", b.priority ? PRIORITY_LABEL[b.priority] : null],
      ],
    },
  ];

  if (b.type === "PL" || b.type === "MDD") {
    sections.push({
      title: TYPE_LABEL[b.type],
      step: 2,
      rows: [
        ["Cliente", b.clientId ? (l.clients[b.clientId] ?? `#${b.clientId}`) : b.newClient?.name ? `${b.newClient.name} (nuevo)` : null],
        ["Comercial responsable", b.accountManagerId ? (l.users[b.accountManagerId] ?? null) : null],
        ["Subtipo", b.subtype ? (c.pl_subtype?.[b.subtype] ?? b.subtype) : null],
        ["Mercados", list(b.markets, c.market)],
        ["Canal", list(b.channels, c.channel)],
        ["Nº de referencias", num(b.references)],
        ["Unidades primer pedido", num(b.firstOrderUnits)],
        ["Previsión anual", num(b.annualUnits)],
        ["Precio objetivo de compra", eur(b.targetPrice)],
        ["PVP previsto", eur(b.rrp)],
        ["Diseño aporta", b.designBy ? SUPPLIER_LABEL[b.designBy] : null],
        ["Packaging aporta", b.packagingBy ? SUPPLIER_LABEL[b.packagingBy] : null],
        ["Idiomas de etiquetado", list(b.languages, c.language)],
      ],
    });
  } else if (b.type === "MP") {
    sections.push({
      title: "Marca propia",
      step: 2,
      rows: [
        ["Marca", b.brandId ? (l.brands[b.brandId] ?? null) : null],
        ["Línea / colección", b.line ?? null],
        ["Origen", [b.origin ? (c.mp_origin?.[b.origin] ?? b.origin) : null, b.originText].filter(Boolean).join(" — ") || null],
        ["Cliente/retailer vinculado", b.linkedClientId ? (l.clients[b.linkedClientId] ?? null) : null],
        ["Mercados", list(b.markets, c.market)],
        ["Canal", list(b.channels, c.channel)],
        ["PVP objetivo", eur(b.rrp)],
        ["Unidades estimadas (1er año)", num(b.annualUnits)],
        ["Justificación / oportunidad", b.justification ?? null],
      ],
    });
  }

  if (b.category) {
    const rows: Row[] = [
      ["Formato", formatFormat(b, l)],
      ["Capacidad", num(b.capacityMl, " ml")],
    ];
    if (b.category === "ambient") rows.push(["Duración / rendimiento", b.performance ?? null]);
    if (b.category === "cosmetic") {
      rows.push(
        ["Función y claims", [list(b.functions), b.claimsText].filter(Boolean).join(" · ") || null],
        ["Tipo de piel/cabello", b.skinHairType ?? null],
        ["Público", list(b.audience)],
        ["Textura", b.texture ?? null],
        ["¿Lleva perfume?", b.hasPerfume == null ? null : b.hasPerfume ? "Sí" : "No"],
        ["Ingredientes deseados", b.ingredientsWanted ?? null],
        ["Ingredientes a evitar", b.ingredientsAvoid ?? null],
      );
    }
    sections.push({ title: "Producto", step: 3, rows });
  }

  if (needsOlfactory(b)) {
    const o = b.olfactory ?? {};
    sections.push({
      title: "Bloque olfativo",
      step: 3,
      rows: [
        ["Familias", list(o.families)],
        ["Notas de salida", list(o.top)],
        ["Notas de corazón", list(o.heart)],
        ["Notas de fondo", list(o.base)],
        ["Intensidad", o.intensity ? `${o.intensity} / 5` : null],
        ["Duración deseada", o.duration ?? null],
        ["Género", o.genders?.length ? o.genders.map((g) => GENDER_LABEL[g]).join(", ") : null],
        [
          "Referencias de inspiración",
          o.inspirations
            ?.filter((i) => i.product || i.brand || i.url)
            .map((i) => `${i.product}${i.brand ? ` (${i.brand})` : ""}${i.likes ? `: ${i.likes}` : ""}${i.url ? ` — ${i.url}` : ""}`)
            .join(" · ") || null,
        ],
        ["Blacklist", o.blacklist ?? null],
      ],
    });
  }

  sections.push({ title: "Notas", step: 4, rows: [["Notas adicionales", b.notes ?? null]] });
  return sections;
}
