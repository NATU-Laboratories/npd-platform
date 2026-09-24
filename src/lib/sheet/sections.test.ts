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
    expect(missing).toEqual(["Presupuesto aprobado por el cliente (P2)", "PVP recomendado"]);
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

  it("regulatorio: precarga desde el brief (denominación, ml, fl oz, idiomas por mercado)", () => {
    const s = SECTION_BY_KEY.regulatorio!;
    const d = effectiveData(s, { ...ctx, brief: { format: "edp", capacityMl: 100, markets: ["ES", "BE", "FR"] } }, null);
    expect(d.denomination).toBe("agua_perfume");
    expect(d.nominalMl).toBe(100);
    expect(d.nominalFlOz).toBe(3.4);
    expect(d.languages).toEqual(["es", "fr", "nl"]);
  });

  it("campos obligatorios condicionales y validación del código de barras", () => {
    const s = SECTION_BY_KEY.identificacion!;
    const missing = (data: Record<string, unknown>) =>
      requirements(s, ctx, data)
        .filter((r) => !r.ok)
        .map((r) => r.label);
    expect(missing({ productName: "Flor", barcodeType: "no", qr: "no" })).toEqual([]);
    expect(missing({ productName: "Flor", barcodeType: "ean13", qr: "si" })).toEqual(["Código", "Destino del QR (URL o contenido)"]);
    expect(missing({ productName: "Flor", barcodeType: "ean13", barcode: "8412345", qr: "no" })).toEqual(["Código de barras: 13 dígitos (EAN-13) u 8 (EAN-8)"]);
    expect(missing({ productName: "Flor", barcodeType: "ean13", barcode: "8412345 678905", qr: "no" })).toEqual([]);
  });
});
