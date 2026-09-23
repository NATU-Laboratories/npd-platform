/** Diff plano {ruta: {from, to}} entre dos objetos JSON. */
export function jsonDiff(before: unknown, after: unknown, prefix = ""): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if (isObj(before) || isObj(after)) {
    const b = isObj(before) ? before : {};
    const a = isObj(after) ? after : {};
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
      Object.assign(out, jsonDiff(b[k], a[k], prefix ? `${prefix}.${k}` : k));
    }
    return out;
  }
  if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) {
    out[prefix] = { from: before ?? null, to: after ?? null };
  }
  return out;
}
