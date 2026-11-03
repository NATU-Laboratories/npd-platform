import { CATEGORY_LABEL, TYPE_LABEL } from "@/lib/labels";
import type { Option } from "@/lib/catalog-defaults";

/** «Aplica a …» legible de una plantilla. */
export function appliesToSummary(a: { types?: string[]; subtypes?: string[]; categories?: string[] }, subtypes: Option[]) {
  const parts = [
    a.types?.length ? a.types.map((t) => TYPE_LABEL[t as keyof typeof TYPE_LABEL] ?? t).join(" / ") : "Todos los tipos",
    a.subtypes?.length ? a.subtypes.map((s) => subtypes.find((o) => o.value === s)?.label ?? s).join(", ") : null,
    a.categories?.length ? a.categories.map((c) => CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c).join(", ") : "todas las categorías",
  ];
  return `Aplica a: ${parts.filter(Boolean).join(" · ")}`;
}
