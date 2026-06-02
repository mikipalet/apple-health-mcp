import crypto from "node:crypto";
import { requireEnv } from "@/lib/env";

// Minimal, STATELESS OAuth 2.1 for a single personal user, so claude.ai web/mobile
// (which require OAuth for custom connectors) can connect. No DB tables and no deps:
// authorization codes and access tokens are self-contained HMAC-signed blobs we can
// verify on the next request. Security model: the /authorize step is gated by the
// MCP_SECRET (used as a password), so only someone holding the secret can mint a
// code. Codes are PKCE-bound; tokens are opaque to the client.

const CODE_TTL_S = 600; // authorization codes: 10 minutes
const ACCESS_TTL_S = 60 * 60 * 24 * 90; // access tokens: 90 days

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function hmac(data: string): string {
  return crypto.createHmac("sha256", requireEnv("MCP_SECRET")).update(data).digest("base64url");
}

// Sign a payload into a compact `base64url(json).hmac` token.
export function sign(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body)}`;
}

// Verify signature + expiry; returns the payload or null. Constant-time signature
// comparison to avoid timing leaks.
export function verify(token: string): Record<string, unknown> | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
  if (typeof payload.exp === "number" && payload.exp < nowSec()) return null;
  return payload;
}

// PKCE: code_challenge = base64url(sha256(code_verifier)) for method S256.
export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method === "plain") {
    const a = Buffer.from(verifier);
    const b = Buffer.from(challenge);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const computed = crypto.createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Mint a PKCE-bound authorization code carrying the challenge + redirect_uri.
export function issueCode(p: { cc: string; ccm: string; ru: string; cid: string }): string {
  return sign({ t: "code", cc: p.cc, ccm: p.ccm, ru: p.ru, cid: p.cid, exp: nowSec() + CODE_TTL_S });
}

export function issueAccessToken(): string {
  return sign({ t: "access", exp: nowSec() + ACCESS_TTL_S });
}

export const ACCESS_TTL_SECONDS = ACCESS_TTL_S;

// An access token is valid if it verifies and is of type "access".
export function validateAccessToken(token: string): boolean {
  const p = verify(token);
  return !!p && p.t === "access";
}

// Token-endpoint logic: exchange an authorization code (+ PKCE verifier) for an
// access token. Pure and fully unit-testable.
export function exchangeCode(params: {
  grant_type?: string;
  code?: string;
  code_verifier?: string;
  redirect_uri?: string;
}): { access_token: string; expires_in: number } | { error: string } {
  if (params.grant_type !== "authorization_code") return { error: "unsupported_grant_type" };
  if (!params.code) return { error: "invalid_request" };
  const p = verify(params.code);
  if (!p || p.t !== "code") return { error: "invalid_grant" };
  if (params.redirect_uri && p.ru && params.redirect_uri !== p.ru) return { error: "invalid_grant" };
  const cc = typeof p.cc === "string" ? p.cc : "";
  const ccm = typeof p.ccm === "string" ? p.ccm : "S256";
  if (cc) {
    if (!params.code_verifier) return { error: "invalid_grant" };
    if (!verifyPkce(params.code_verifier, cc, ccm)) return { error: "invalid_grant" };
  }
  return { access_token: issueAccessToken(), expires_in: ACCESS_TTL_S };
}

// Public base URL of the deployment, derived from forwarded headers (Vercel) so the
// issuer/endpoints in OAuth metadata match the host the client actually used.
export function baseUrl(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}
