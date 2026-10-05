import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Development only: the default bottom-left badge covers the signed-in
  // user in the app's sidebar footer.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
