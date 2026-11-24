import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./authz", () => ({ isAdmin: (u: { roles: string[] }) => u.roles.includes("admin") }));

const base = { id: "u1", email: "Persona@NatuAromatic.com", name: "Persona", status: "active" as const, roles: [] as never[], departmentIds: [], deciderFor: [] };

describe("agente de newsletters", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("solo Marketing, Diseño y administradores pueden usarlo", async () => {
    const { canUseNewsletters } = await import("./newsletter-agent");
    expect(canUseNewsletters({ ...base, departmentKeys: ["marketing"] })).toBe(true);
    expect(canUseNewsletters({ ...base, departmentKeys: ["diseno"] })).toBe(true);
    expect(canUseNewsletters({ ...base, departmentKeys: [], roles: ["admin"] as never[] })).toBe(true);
    expect(canUseNewsletters({ ...base, departmentKeys: ["idi", "calidad"] })).toBe(false);
  });

  it("envía la petición con el email de quien la pide y la clave de Alexia", async () => {
    process.env.NEWSLETTER_AGENT_URL = "https://agente.test/";
    process.env.NEWSLETTER_AGENT_KEY = "clave";
    const fetchMock = vi.fn(async () => new Response('{"peticion_id":"x"}', { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const { crearNewsletter } = await import("./newsletter-agent");
    await crearNewsletter({ ...base, departmentKeys: ["marketing"] }, {
      marca: "natu", tipo_campana: "felicitacion", objetivo: "Felicitar la Navidad", mensaje: "Felices fiestas", idiomas: ["es", "it"], fecha_envio: "2026-12-18T10:00",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://agente.test/v1/newsletters");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer clave");
    const body = JSON.parse(String(init.body));
    expect(body.solicitante_email).toBe("Persona@NatuAromatic.com");
    expect(body.idiomas).toEqual(["es", "it"]);
    expect(body).not.toHaveProperty("programar");
  });
});
