import { describe, expect, it } from "vitest";
import { effectiveData, progress, requirements, sanitizeData, SECTION_BY_KEY, type SheetCtx } from "./sections";

const ctx: SheetCtx = {
  olfactory: true,
  quotedAt: "2026-09-20T10:00:00Z",
  quoteAmount: 12500,
  g2At: null,
  prepayment: null,
  brief: { targetPrice: 4.2, rrp: null, unitsFirstOrder: 1000 },
  filesByTag: { cotizacion: 1 },
};

describe("ficha técnica", () => {
  it("comercial: precarga del brief y requisitos automáticos", () => {
    const s = SECTION_BY_KEY.comercial!;
    const data = effectiveData(s, ctx, { unitPrice: 4.35 });
    expect(data.targetPrice).toBe(4.2);
    const reqs = requirements(s, ctx, data);
    const missing = reqs.filter((r) => !r.ok).map((r) => r.label);
    expect(missing).toEqual(["Presupuesto aprobado por el cliente (G2)", "PVP recomendado", "Aprobación del cliente (presupuesto firmado, pedido o email)"]);
    expect(progress(reqs).complete).toBe(false);
  });

  it("fórmula: exige pirámide solo si hay bloque olfativo y una referencia aprobada", () => {
    const s = SECTION_BY_KEY.formula!;
    const refs = { references: [{ name: "A", approved: true }] };
    expect(progress(requirements(s, ctx, refs)).complete).toBe(false);
    expect(progress(requirements(s, { ...ctx, olfactory: false }, refs)).complete).toBe(true);
    const full = { references: [{ name: "A", top: ["bergamota"], heart: ["jazmín"], base: ["vainilla"], approved: true }] };
    expect(progress(requirements(s, ctx, full)).complete).toBe(true);
    expect(progress(requirements(s, ctx, { references: [{ ...full.references[0], approved: false }] })).complete).toBe(false);
  });

  it("sanitizeData descarta campos desconocidos y valores no válidos", () => {
    const s = SECTION_BY_KEY.regulatorio!;
    const out = sanitizeData(s, { inci: "  AQUA  ", languages: ["es", "xx"], pictograms: "GHS02", hack: 1 });
    expect(out).toEqual({ inci: "AQUA", languages: ["es"] });
    const c = sanitizeData(SECTION_BY_KEY.comercial!, { unitPrice: "4,356", rrp: -3 });
    expect(c).toEqual({ unitPrice: 4.36 });
  });
});
