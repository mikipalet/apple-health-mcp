import { baseUrl } from "@/lib/oauth";

// RFC 8414 Authorization Server Metadata. Advertises our authorize/token/register
// endpoints so claude.ai can drive the OAuth flow. CORS-open so browser-side
// discovery works.
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

export function GET(req: Request) {
  const base = baseUrl(req);
  return Response.json(
    {
      issuer: base,
      authorization_endpoint: `${base}/api/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256", "plain"],
      token_endpoint_auth_methods_supported: ["none"],
    },
    { headers: cors },
  );
}
