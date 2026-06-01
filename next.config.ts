import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Streamable HTTP MCP clients (claude.ai web/mobile) connect to /mcp/<secret>.
      // The secret travels as a query param to /api/mcp where auth.ts reads it.
      { source: "/mcp/:secret", destination: "/api/mcp?key=:secret" },
    ];
  },
};

export default nextConfig;
