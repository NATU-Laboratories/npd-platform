import { describe, expect, it } from "vitest";
import { computeCompleteness, missingFields, submitErrors } from "./fields";
import { parseBriefLenient, type BriefData } from "./schema";

const plBase: BriefData = {
  type: "PL",
  category: "perfume",
  name: "Body mist",
  neededBy: "2026-10-15",
  neededByReason: "feria",
  priority: "high",
  clientId: 1,
  accountManagerId: "00000000-0000-4000-8000-000000000000",
  subtype: "desarrollo_completo",
  markets: ["ES"],
  channels: ["online"],
  references: 2,
  firstOrderUnits: 1000,
  designBy: "natu",
  packagingBy: "cliente",
  format: "body_mist",
  olfactory: { families: ["Cítrico"], genders: ["unisex"] },
};

describe("submitErrors", () => {
  it("acepta un brief PL con todos los obligatorios", () => {
    expect(submitErrors(plBase)).toEqual({});
  });

  it("exige el bloque olfativo en perfumería (familias y género)", () => {
    const errs = submitErrors({ ...plBase, olfactory: {} });
    expect(errs["olfactory.families"]).toBeDefined();
    expect(errs["olfactory.genders"]).toBeDefined();
  });

  it("MDD usa los obligatorios de cliente como PL", () => {
    expect(submitErrors({ ...plBase, type: "MDD" })).toEqual({});
    expect(submitErrors({ ...plBase, type: "MDD", clientId: undefined }).clientId).toBeDefined();
  });

  it("no exige olfativo en cosmética sin perfume", () => {
    const b: BriefData = { ...plBase, category: "cosmetic", format: "crema", hasPerfume: false, olfactory: undefined };
    expect(submitErrors(b)).toEqual({});
  });

  it("exige detalle cuando el motivo de la fecha es 'otro'", () => {
    expect(submitErrors({ ...plBase, neededByReason: "otro" }).neededByReasonText).toBeDefined();
  });

  it("acepta cliente nuevo en lugar de uno del catálogo", () => {
    expect(submitErrors({ ...plBase, clientId: undefined, newClient: { name: "Nuevo SL" } })).toEqual({});
  });

  it("aplica los obligatorios de marca propia", () => {
    const errs = submitErrors({ ...plBase, type: "MP" });
    expect(Object.keys(errs).sort()).toEqual(["brandId", "justification", "origin"]);
  });
});

describe("computeCompleteness", () => {
  it("es 0 con un brief vacío y 100 con todo relleno", () => {
    expect(computeCompleteness({})).toBe(0);
    const full: BriefData = {
      ...plBase,
      annualUnits: 5000,
      targetPrice: 1.2,
      rrp: 4.99,
      languages: ["es"],
      capacityMl: 250,
      olfactory: { families: ["Cítrico"], top: ["Limón"], intensity: 3, inspirations: [{ product: "X", brand: "Y", likes: "", url: "" }], genders: ["mujer", "hombre"] },
    };
    expect(computeCompleteness(full)).toBe(100);
    expect(missingFields(full, "recommended")).toEqual([]);
  });
});

describe("parseBriefLenient", () => {
  it("descarta valores inválidos y conserva el resto", () => {
    const { data, errors } = parseBriefLenient({ name: "Ok", references: "abc", neededBy: "15/10/2026", markets: ["ES"] });
    expect(data.name).toBe("Ok");
    expect(data.markets).toEqual(["ES"]);
    expect(data.references).toBeUndefined();
    expect(Object.keys(errors).sort()).toEqual(["neededBy", "references"]);
  });

  it("convierte cadenas vacías y numéricas", () => {
    const { data } = parseBriefLenient({ priority: "", firstOrderUnits: "12000", rrp: "4,99" });
    expect(data.priority).toBeUndefined();
    expect(data.firstOrderUnits).toBe(12000);
    expect(data.rrp).toBe(4.99);
  });
});

describe("olfactorySchema", () => {
  it("convierte el género antiguo (único) al nuevo formato múltiple", () => {
    const { data } = parseBriefLenient({ olfactory: { gender: "femenino", families: ["Floral"] } });
    expect(data.olfactory?.genders).toEqual(["mujer"]);
  });
  it("valida el enlace de Fragrantica", () => {
    const ok = parseBriefLenient({ olfactory: { inspirations: [{ product: "X", url: "https://www.fragrantica.es/perfume/x.html" }] } });
    expect(ok.data.olfactory?.inspirations?.[0]?.url).toContain("fragrantica");
    const bad = parseBriefLenient({ olfactory: { inspirations: [{ product: "X", url: "fragrantica" }] } });
    expect(Object.keys(bad.errors)[0]).toContain("url");
  });
});
