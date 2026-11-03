import "server-only";
import { and, sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * Búsqueda tolerante: sin distinguir mayúsculas, tildes, espacios ni signos, y con las
 * palabras en cualquier orden («bodymist citrico verano» encuentra «Body mist cítrico verano»).
 */
const FROM = "áàäâãéèëêíìïîóòöôõúùüûñç";
const TO = "aaaaaeeeeiiiiooooouuuunc";

export function normalizeText(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Palabras de búsqueda normalizadas (las de una letra se ignoran). */
export function searchTokens(q: string) {
  return q
    .split(/\s+/)
    .map(normalizeText)
    .filter((t) => t.length >= 2)
    .slice(0, 8);
}

/** Texto normalizado en SQL (mismas reglas que normalizeText). */
export function normalizedSql(cols: SQLWrapper[]) {
  const joined = sql.join(
    cols.map((c) => sql`coalesce(${c}, '')`),
    sql` || ' ' || `,
  );
  return sql`regexp_replace(translate(lower(${joined}), ${FROM}, ${TO}), '[^a-z0-9]', '', 'g')`;
}

/** Condición: todas las palabras aparecen en alguno de los campos. Null si no hay palabras. */
export function fuzzyMatch(q: string, cols: SQLWrapper[]): SQL | null {
  const tokens = searchTokens(q);
  if (!tokens.length) return null;
  const hay = normalizedSql(cols);
  return and(...tokens.map((t) => sql`${hay} like ${`%${t}%`}`))!;
}
