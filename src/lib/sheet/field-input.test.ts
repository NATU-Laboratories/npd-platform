import { describe, expect, it } from "vitest";
import { findSheetField, parseFieldValue } from "./field-input";

const one = (campo: string, apartado?: string) => {
  const r = findSheetField(campo, apartado);
  expect(r).toHaveLength(1);
  return r[0]!;
};

describe("Alexia: campo de la ficha a partir de lo que dice la persona", () => {
  it("encuentra el campo por su nombre aunque falten tildes", () => {
    expect(one("codigo ufi").field.key).toBe("ufi");
    expect(one("Lote (formato y ubicación del marcaje)").field.key).toBe("lot");
  });
  it("con palabras de varios grupos usa el grupo para desambiguar", () => {
    const r = findSheetField("proveedor");
    expect(r.length).toBeGreaterThan(1);
    expect(one("proveedor tapón").field.key).toBe("capSupplier");
  });
  it("el apartado acota la búsqueda", () => {
    expect(findSheetField("modelo", "Envase y packaging").every((c) => c.section.key === "packaging")).toBe(true);
  });
  it("no ofrece campos de archivos ni de filas", () => {
    expect(findSheetField("persona responsable")).toHaveLength(0);
  });
});

describe("Alexia: valor según el tipo del campo", () => {
  const field = (campo: string) => one(campo).field;
  it("números con coma decimal y miles con punto", () => {
    expect(parseFieldValue(field("cantidad en fl oz"), "3,4 fl oz")).toEqual({ ok: true, value: 3.4 });
    expect(parseFieldValue(field("cantidad en fl oz"), "1.000")).toEqual({ ok: true, value: 1000 });
  });
  it("sí / no", () => {
    expect(parseFieldValue(field("Lleva «MADE IN SPAIN»"), "sí")).toEqual({ ok: true, value: true });
    expect(parseFieldValue(field("Lleva «MADE IN SPAIN»"), "no")).toEqual({ ok: true, value: false });
  });
  it("opciones por su nombre, y avisa de las válidas si no encaja", () => {
    expect(parseFieldValue(field("UFI"), "pendiente")).toEqual({ ok: true, value: "pendiente" });
    const bad = parseFieldValue(field("UFI"), "quizá");
    expect(bad.ok).toBe(false);
  });
  it("varias opciones separadas por comas o «y»", () => {
    const f = field("idiomas de la etiqueta");
    const r = parseFieldValue(f, "español y francés");
    expect(r.ok).toBe(true);
    expect((r as { value: string[] }).value.length).toBe(2);
  });
});

describe("Alexia: frases naturales", () => {
  it("ignora «del», «de la»…", () => {
    expect(one("proveedor del tapón").field.key).toBe("capSupplier");
  });
});
