import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/graph/mail", () => ({ mailDriver: () => "graph" }));
vi.mock("./settings", () => ({ getSettings: async () => ({ sender_mailbox: "" }) }));

let mod: typeof import("./reply-address");
const REP = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f";

beforeAll(async () => {
  process.env.INBOUND_SECRET = "secreto-de-prueba";
  mod = await import("./reply-address");
});

describe("dirección de respuesta de presupuestos", () => {
  it("usa plus addressing sobre el buzón de la plataforma", () => {
    const a = mod.quoteReplyAddress("Projects@NatuAromatic.com", REP, 12)!;
    expect(a).toMatch(/^projects\+cot-[0-9a-f]{32}-12-[0-9a-f]{12}@natuaromatic\.com$/);
    expect(a.split("@")[0]!.length).toBeLessThanOrEqual(64);
  });

  it("reconoce la dirección entre los destinatarios y rechaza firmas falsas", () => {
    const a = mod.quoteReplyAddress("projects@natuaromatic.com", REP, 12)!;
    expect(mod.findReplyTarget(`compras@natuaromatic.com ${a.toUpperCase()}`)).toEqual({ kind: "replenishment", id: REP, supplierId: 12 });
    expect(mod.findReplyTarget(a.replace("-12-", "-13-"))).toBeNull();
  });

  it("distingue las de componentes de proyecto y no admite cambiar el tipo", () => {
    const a = mod.quoteReplyAddress("projects@natuaromatic.com", REP, 7, "project")!;
    expect(a).toMatch(/^projects\+cpr-/);
    expect(mod.findReplyTarget(a)).toEqual({ kind: "project", id: REP, supplierId: 7 });
    expect(mod.findReplyTarget(a.replace("+cpr-", "+cot-"))).toBeNull();
  });

  it("sin buzón válido no hay dirección", () => {
    expect(mod.quoteReplyAddress(null, REP, 1)).toBeNull();
    expect(mod.quoteReplyAddress("no-es-un-email", REP, 1)).toBeNull();
  });

  it("comprueba el clientState de la suscripción de Graph", () => {
    expect(mod.clientStateOk(mod.graphClientState())).toBe(true);
    expect(mod.clientStateOk("otro")).toBe(false);
  });
});
