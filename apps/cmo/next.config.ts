import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    turbopackGc: true,
    turbopackLazyDynamicImports: true,
    agentUpgrade: "security",
  },
};

export default nextConfig;
