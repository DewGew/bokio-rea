import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SIE- och CSV-filer skickas till serveråtgärder (standardgränsen är 1 MB).
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  // Metadata för MCP-kopplingar (OAuth) på standardadresserna.
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/protected-resource" },
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/protected-resource" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/metadata" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/metadata" },
      { source: "/.well-known/openid-configuration", destination: "/api/oauth/metadata" },
    ];
  },
};

export default nextConfig;
