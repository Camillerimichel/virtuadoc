import type { NextConfig } from "next";

const documentEngineUrl = process.env.DOCUMENT_ENGINE_URL || "http://127.0.0.1:8090";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  output: "standalone",
  experimental: {
    proxyClientMaxBodySize: 100 * 1024 * 1024,
  },
  async rewrites() {
    return [
      {
        source: "/api/document-engine/:path*",
        destination: `${documentEngineUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
