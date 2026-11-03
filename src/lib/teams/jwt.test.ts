import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyBotJwt, type Jwk } from "./jwt";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as Jwk), kid: "k1" };
const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token(claims: object, kid = "k1") {
  const head = `${enc({ alg: "RS256", kid })}.${enc(claims)}`;
  return `${head}.${sign("RSA-SHA256", Buffer.from(head), privateKey).toString("base64url")}`;
}
const now = Date.now();
const base = { iss: "https://api.botframework.com", aud: "app-1", exp: Math.floor(now / 1000) + 600, serviceurl: "https://smba.trafficmanager.net/emea/" };
const opts = { issuer: "https://api.botframework.com", audience: "app-1", serviceUrl: "https://smba.trafficmanager.net/emea/", now };

describe("verifyBotJwt", () => {
  it("acepta un token válido", () => expect(verifyBotJwt(token(base), [jwk], opts)).not.toBeNull());
  it("rechaza otra audiencia", () => expect(verifyBotJwt(token({ ...base, aud: "otra" }), [jwk], opts)).toBeNull());
  it("rechaza otro emisor", () => expect(verifyBotJwt(token({ ...base, iss: "https://evil" }), [jwk], opts)).toBeNull());
  it("rechaza tokens caducados", () => expect(verifyBotJwt(token({ ...base, exp: Math.floor(now / 1000) - 3600 }), [jwk], opts)).toBeNull());
  it("rechaza un serviceUrl distinto", () => expect(verifyBotJwt(token({ ...base, serviceurl: "https://evil/" }), [jwk], opts)).toBeNull());
  it("rechaza firmas manipuladas", () => {
    const t = token(base).split(".");
    expect(verifyBotJwt(`${t[0]}.${enc({ ...base, aud: "app-1", extra: 1 })}.${t[2]}`, [jwk], opts)).toBeNull();
  });
  it("rechaza claves desconocidas", () => expect(verifyBotJwt(token(base, "k2"), [jwk], opts)).toBeNull());
});
