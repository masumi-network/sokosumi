import type { MetadataRoute } from "next";

import { getEnvPublicConfig } from "@/config/env.public";

export default function robots(): MetadataRoute.Robots {
  const isMainnet = getEnvPublicConfig().NEXT_PUBLIC_NETWORK === "Mainnet";
  if (!isMainnet) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }

  // Mainnet environment - allow all crawlers
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
  };
}
