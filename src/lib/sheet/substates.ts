/** Reglas de transición entre subestados de un departamento (módulo puro). */
export type SubstateLike = { id: number; isFinal: boolean; canReturnTo: number[] };

/**
 * Desde el subestado actual (null = sin empezar, en el primero):
 * - `next`: el siguiente en orden (ninguno si el actual es final).
 * - `backTargets`: los subestados a los que se permite volver.
 */
export function transitionsFrom<T extends SubstateLike>(steps: T[], current: T | null): { next: T | null; backTargets: T[] } {
  if (!current) return { next: steps[1] ?? null, backTargets: [] };
  const idx = steps.findIndex((s) => s.id === current.id);
  const next = current.isFinal ? null : (steps[idx + 1] ?? null);
  const backTargets = steps.filter((s) => current.canReturnTo.includes(s.id) && s.id !== current.id);
  return { next, backTargets };
}
