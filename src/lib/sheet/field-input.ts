/**
 * Lo que dice una persona («apunta el proveedor del tapón: Tapones Levante») → campo de la
 * ficha y valor con su tipo. Módulo puro (lo usa Alexia en el servidor y se prueba aparte).
 */
import { SHEET_SECTIONS, type ScalarField, type SheetSection } from "./sections";

/** Sin mayúsculas, tildes, espacios ni signos (mismas reglas que la búsqueda de proyectos). */
export function normalizeText(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Palabras que no ayudan a identificar el campo («proveedor del tapón» → proveedor, tapon). */
const STOPWORDS = new Set(["de", "del", "la", "el", "los", "las", "lo", "un", "una", "y", "e", "en", "para", "por", "con", "que", "al", "su", "sus"]);

export function searchTokens(q: string) {
  return q
    .split(/\s+/)
    .map(normalizeText)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .slice(0, 8);
}

const SKIP_TYPES = new Set(["files", "rows"]);

/** Campo de la ficha a partir de lo que dice la persona (tolerante a tildes y orden de palabras). */
export function findSheetField(campo: string, apartado?: string): { section: SheetSection; field: ScalarField; group: string }[] {
  const sections = apartado?.trim()
    ? SHEET_SECTIONS.filter((s) => searchTokens(apartado).every((t) => normalizeText(`${s.title} ${s.key}`).includes(t)))
    : SHEET_SECTIONS;
  const tokens = searchTokens(campo);
  const all = sections.flatMap((section) =>
    section.groups.flatMap((g) => g.fields.filter((f): f is ScalarField => !SKIP_TYPES.has(f.type)).map((field) => ({ section, field, group: g.title ?? "" }))),
  );
  const exact = all.filter((c) => normalizeText(c.field.label) === normalizeText(campo));
  if (exact.length) return exact;
  return all.filter((c) => tokens.length && tokens.every((t) => normalizeText(`${c.field.label} ${c.group} ${c.section.title} ${c.field.key}`).includes(t)));
}

/** Convierte lo que dice la persona al tipo del campo. */
export function parseFieldValue(f: ScalarField, raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const v = raw.trim();
  const n = normalizeText(v);
  switch (f.type) {
    case "number":
    case "money": {
      const m = v.replace(/\s/g, "").replace(/(\d)\.(\d{3})(?!\d)/g, "$1$2").match(/-?\d+([.,]\d+)?/);
      return m ? { ok: true, value: Number(m[0].replace(",", ".")) } : { ok: false, error: `«${f.label}» es un número` };
    }
    case "bool":
      if (["si", "sí", "yes", "true", "x", "ok", "hecho", "aprobado", "aprobados"].map(normalizeText).includes(n)) return { ok: true, value: true };
      if (["no", "false"].includes(n)) return { ok: true, value: false };
      return { ok: false, error: `«${f.label}» es sí o no` };
    case "date": {
      const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const es = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
      if (iso) return { ok: true, value: v };
      if (es) return { ok: true, value: `${es[3]}-${es[2]!.padStart(2, "0")}-${es[1]!.padStart(2, "0")}` };
      return { ok: false, error: `«${f.label}» es una fecha (dd/mm/aaaa)` };
    }
    case "select": {
      const o = f.options.find((x) => normalizeText(x.label) === n || x.value === v) ?? f.options.filter((x) => normalizeText(x.label).includes(n)).at(0);
      return o ? { ok: true, value: o.value } : { ok: false, error: `Opciones de «${f.label}»: ${f.options.map((x) => x.label).join(", ")}` };
    }
    case "multi": {
      const parts = v.split(/[,;]| y /).map((x) => normalizeText(x)).filter(Boolean);
      const picked = parts.map((p) => f.options.find((x) => normalizeText(x.label) === p || normalizeText(x.label).includes(p)));
      if (picked.some((x) => !x)) return { ok: false, error: `Opciones de «${f.label}»: ${f.options.map((x) => x.label).join(", ")}` };
      return { ok: true, value: [...new Set(picked.map((x) => x!.value))] };
    }
    default:
      return { ok: true, value: v };
  }
}

