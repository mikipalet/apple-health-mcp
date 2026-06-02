import { baseUrl } from "@/lib/oauth";

// RFC 9728 Protected Resource Metadata. Tells the client which authorization server
// guards the MCP resource. Referenced by the 401 WWW-Authenticate challenge.
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
      resource: `${base}/api/mcp`,
      authorization_servers: [base],
    },
    { headers: cors },
  );
}
