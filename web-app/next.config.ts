import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/app",
        destination: "/app/gallery",
      },
      {
        source: "/app/gallery",
        destination: "/app/agents",
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "c-ipfs-gw.nmkr.io",
      },
    ],
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
