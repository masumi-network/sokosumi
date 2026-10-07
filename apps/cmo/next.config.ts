import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Development only: the default bottom-left badge covers the signed-in
  // user in the app's sidebar footer.
  devIndicators: { position: "bottom-right" },
  experimental: {
    turbopackGc: true,
    turbopackLazyDynamicImports: true,
    agentUpgrade: "security",
  },
};

export default nextConfig;
