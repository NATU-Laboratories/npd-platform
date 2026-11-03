import { createPublicKey, verify, type JsonWebKey } from "node:crypto";

export type Jwk = JsonWebKey & { kid?: string; endorsements?: string[] };

const b64 = (s: string) => Buffer.from(s, "base64url");

/**
 * Verifica un JWT RS256 de Bot Framework con las claves dadas: firma, emisor,
 * audiencia (ID de la app del bot), caducidad y que el serviceUrl coincida con el de la actividad.
 * Devuelve los claims si es válido o null.
 */
export function verifyBotJwt(
  token: string,
  keys: Jwk[],
  opts: { issuer: string; audience: string; serviceUrl?: string; now?: number },
): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64(parts[0]!).toString("utf8")) as { alg?: string; kid?: string };
    if (header.alg !== "RS256" || !header.kid) return null;
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const ok = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), b64(parts[2]!));
    if (!ok) return null;
    const claims = JSON.parse(b64(parts[1]!).toString("utf8")) as Record<string, unknown>;
    const now = Math.floor((opts.now ?? Date.now()) / 1000);
    const skew = 300; // 5 min de margen de reloj, como recomienda Bot Framework
    if (claims.iss !== opts.issuer) return null;
    const aud = claims.aud;
    if (Array.isArray(aud) ? !aud.includes(opts.audience) : aud !== opts.audience) return null;
    if (typeof claims.exp !== "number" || claims.exp + skew < now) return null;
    if (typeof claims.nbf === "number" && claims.nbf - skew > now) return null;
    if (opts.serviceUrl && claims.serviceurl && String(claims.serviceurl).replace(/\/$/, "") !== opts.serviceUrl.replace(/\/$/, "")) return null;
    return claims;
  } catch {
    return null;
  }
}
