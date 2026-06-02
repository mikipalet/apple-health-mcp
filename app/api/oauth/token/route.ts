import { exchangeCode } from "@/lib/oauth";

// Token endpoint (RFC 6749 §4.1.3 + PKCE). Accepts the authorization code + PKCE
// verifier, returns an opaque bearer access token. CORS-open for browser-side
// exchange.
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "*",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

export async function POST(req: Request) {
  // Token requests are form-urlencoded.
  const form = await req.formData();
  const get = (k: string) => form.get(k)?.toString();

  const result = exchangeCode({
    grant_type: get("grant_type"),
    code: get("code"),
    code_verifier: get("code_verifier"),
    redirect_uri: get("redirect_uri"),
  });

  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400, headers: cors });
  }
  return Response.json(
    { access_token: result.access_token, token_type: "Bearer", expires_in: result.expires_in },
    { headers: cors },
  );
}
