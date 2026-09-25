import { describe, expect, it } from "vitest";
import { checkField, effectiveData, resolveFieldRef, sanitizeData, SECTION_BY_KEY, type SheetCtx } from "./sections";
import { transitionsFrom } from "./substates";

const ctx: SheetCtx = { olfactory: true, brief: { targetPrice: 4.2, rrp: null, unitsFirstOrder: 1000 }, filesByTag: {} };

describe("ficha técnica", () => {
  it("comercial: precarga del brief y sin campos de documentos", () => {
    const s = SECTION_BY_KEY.comercial!;
    const data = effectiveData(s, ctx, { unitPrice: 4.35 });
    expect(data).toMatchObject({ unitPrice: 4.35, targetPrice: 4.2, units: 1000 });
    expect(s.groups.flatMap((g) => g.fields).some((f) => f.type === "files")).toBe(false);
    expect(resolveFieldRef("comercial.finalUnitPrice")?.field.label).toBe("Precio unitario final");
  });

  it("laboratorio: solo la referencia aprobada", () => {
    const fields = SECTION_BY_KEY.formula!.groups.flatMap((g) => g.fields);
    expect(fields.map((f) => f.key)).toEqual(["approvedReference"]);
  });

  it("regulatorio: precarga desde el brief (denominación, ml, fl oz, idiomas por mercado)", () => {
    const d = effectiveData(SECTION_BY_KEY.regulatorio!, { ...ctx, brief: { format: "edp", capacityMl: 100, markets: ["ES", "BE", "FR"] } }, null);
    expect(d).toMatchObject({ denomination: "agua_perfume", nominalMl: 100, nominalFlOz: 3.4, languages: ["es", "fr", "nl"] });
  });

  it("sanitizeData descarta campos desconocidos y valores no válidos", () => {
    expect(sanitizeData(SECTION_BY_KEY.regulatorio!, { inci: "  AQUA  ", languages: ["es", "xx"], hack: 1 })).toEqual({ inci: "AQUA", languages: ["es"] });
    expect(sanitizeData(SECTION_BY_KEY.comercial!, { unitPrice: "4,356", rrp: -3 })).toEqual({ unitPrice: 4.36 });
  });

  it("checkField: valor y validación (código de barras)", () => {
    const f = resolveFieldRef("identificacion.barcode")!.field;
    expect(checkField(f, { barcodeType: "ean13" }).ok).toBe(false);
    expect(checkField(f, { barcodeType: "ean13", barcode: "8412345" })).toEqual({ ok: false, label: "Código de barras: 13 dígitos (EAN-13) u 8 (EAN-8)" });
    expect(checkField(f, { barcodeType: "ean13", barcode: "8412345 678905" }).ok).toBe(true);
  });
});

describe("subestados", () => {
  const steps = [
    { id: 1, isFinal: false, canReturnTo: [] },
    { id: 2, isFinal: false, canReturnTo: [] },
    { id: 3, isFinal: false, canReturnTo: [2] },
    { id: 4, isFinal: true, canReturnTo: [3, 2] },
  ];
  it("sin empezar: se arranca pasando al segundo, sin retrocesos", () => {
    expect(transitionsFrom(steps, null)).toEqual({ next: steps[1], backTargets: [] });
  });
  it("avanza solo al siguiente y retrocede a los permitidos", () => {
    expect(transitionsFrom(steps, steps[2]!)).toEqual({ next: steps[3], backTargets: [steps[1]] });
  });
  it("el final no avanza más", () => {
    expect(transitionsFrom(steps, steps[3]!)).toEqual({ next: null, backTargets: [steps[1], steps[2]] });
  });
});
