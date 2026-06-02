import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // OAuth discovery lives at well-known paths. Next ignores dot-folders under
      // app/, so map them to normal API routes. claude.ai may append the resource
      // path (RFC 8414/9728), so accept an optional trailing path too.
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/metadata/authorization-server" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/metadata/authorization-server" },
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/metadata/protected-resource" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/metadata/protected-resource" },
    ];
  },
};

export default nextConfig;
