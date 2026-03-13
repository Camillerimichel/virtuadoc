import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  output: "standalone",
  experimental: {
    proxyClientMaxBodySize: 100 * 1024 * 1024,
  },
};

export default nextConfig;
