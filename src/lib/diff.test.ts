import { describe, expect, it } from "vitest";
import { jsonDiff } from "./diff";

describe("jsonDiff", () => {
  it("devuelve rutas planas con valor anterior y nuevo", () => {
    expect(jsonDiff({ a: 1, o: { x: [1] } }, { a: 2, o: { x: [1, 2] }, n: "y" })).toEqual({
      a: { from: 1, to: 2 },
      "o.x": { from: [1], to: [1, 2] },
      n: { from: null, to: "y" },
    });
  });
  it("vacío si no hay cambios", () => {
    expect(jsonDiff({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual({});
  });
});
