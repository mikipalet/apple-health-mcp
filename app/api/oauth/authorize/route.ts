import { requireEnv } from "@/lib/env";
import { issueCode } from "@/lib/oauth";

// Authorization endpoint. Because this is a single-user server, "logging in" =
// proving you hold the secret. GET renders a password form (carrying the OAuth
// params as hidden fields); POST checks the secret and, if correct, mints a
// PKCE-bound code and redirects back to the client. This is what keeps the whole
// OAuth flow secure: no secret, no code, no token.

function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// Carry exactly the params we need through the form as hidden inputs.
const PARAMS = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource"] as const;

function page(values: Record<string, string>, error?: string): Response {
  const hidden = PARAMS.map((p) => `<input type="hidden" name="${p}" value="${esc(values[p] ?? "")}">`).join("\n      ");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>apple-health-mcp — Authorize</title></head>
<body style="font-family:system-ui;max-width:420px;margin:10vh auto;padding:0 1rem;color:#111">
  <h1 style="font-size:1.25rem">Connect Apple Health to Claude</h1>
  <p style="color:#555;font-size:.95rem">Enter your access secret to authorize this connection. This is the <code>MCP_SECRET</code> from your deployment.</p>
  ${error ? `<p style="color:#c00;font-size:.9rem">${esc(error)}</p>` : ""}
  <form method="POST" action="/api/oauth/authorize">
      ${hidden}
    <input type="password" name="secret" placeholder="Access secret" autofocus required
      style="width:100%;padding:.6rem;font-size:1rem;border:1px solid #ccc;border-radius:8px;box-sizing:border-box">
    <button type="submit" style="margin-top:.75rem;width:100%;padding:.6rem;font-size:1rem;border:0;border-radius:8px;background:#111;color:#fff;cursor:pointer">Authorize</button>
  </form>
</body></html>`;
  return new Response(html, { status: error ? 401 : 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const values = Object.fromEntries(PARAMS.map((p) => [p, q.get(p) ?? ""]));
  return page(values);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const get = (k: string) => (form.get(k)?.toString() ?? "");
  const values = Object.fromEntries(PARAMS.map((p) => [p, get(p)]));

  if (get("secret") !== requireEnv("MCP_SECRET")) {
    return page(values, "Incorrect secret. Try again.");
  }

  const redirectUri = values.redirect_uri;
  let target: URL;
  try {
    target = new URL(redirectUri);
  } catch {
    return page(values, "Invalid redirect_uri.");
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return page(values, "Unsupported redirect_uri scheme.");
  }

  const code = issueCode({
    cc: values.code_challenge,
    ccm: values.code_challenge_method || "S256",
    ru: redirectUri,
    cid: values.client_id,
  });
  target.searchParams.set("code", code);
  if (values.state) target.searchParams.set("state", values.state);

  return Response.redirect(target.toString(), 302);
}
