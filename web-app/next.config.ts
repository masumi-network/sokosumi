import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withPlausibleProxy } from "next-plausible";

const nextConfig: NextConfig = {
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

export default withNextIntl(withPlausibleProxy()(nextConfig));
