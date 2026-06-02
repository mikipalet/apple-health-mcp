// Dynamic Client Registration (RFC 7591). We don't persist clients — this is a
// single-user server and the /authorize step is gated by the secret, so we accept
// any registration and echo back a generated client_id. PKCE (no client secret).
import crypto from "node:crypto";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "*",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // tolerate empty/invalid body — registration metadata is optional for us
  }
  const clientId = `ahm_${crypto.randomBytes(16).toString("hex")}`;
  return Response.json(
    {
      client_id: clientId,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      redirect_uris: Array.isArray(body.redirect_uris) ? body.redirect_uris : [],
    },
    { status: 201, headers: cors },
  );
}
