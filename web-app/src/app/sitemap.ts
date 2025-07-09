import type { MetadataRoute } from "next";

import { getEnvPublicConfig } from "@/config/env.public";
import { getPublicOnlineAgentsWithValidPricing } from "@/lib/services";

const baseUrl = getEnvPublicConfig().NEXT_PUBLIC_SOKOSUMI_URL;
const staticPagesLastModified = new Date("2025-07-08T14:47:50+00:00");

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Fetch agents from database to get real lastModified dates
  const publicOnlineAgents = await getPublicOnlineAgentsWithValidPricing();

  // Static pages with appropriate lastModified dates
  const staticPages = [
    {
      url: new URL("/", baseUrl).toString(),
      lastModified: staticPagesLastModified,
      changeFrequency: "yearly" as const,
      priority: 1,
    },
    {
      url: new URL("/agents", baseUrl).toString(),
      lastModified: staticPagesLastModified,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    },
    {
      url: new URL("/login", baseUrl).toString(),
      lastModified: staticPagesLastModified,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    },
    {
      url: new URL("/register", baseUrl).toString(),
      lastModified: staticPagesLastModified,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    },
    {
      url: new URL("/forgot-password", baseUrl).toString(),
      lastModified: staticPagesLastModified,
      changeFrequency: "monthly" as const,
      priority: 0.64,
    },
    {
      url: new URL("/imprint", baseUrl).toString(),
      lastModified: staticPagesLastModified,
      changeFrequency: "yearly" as const,
      priority: 0.8,
    },
    {
      url: new URL("/privacy-policy", baseUrl).toString(),
      lastModified: staticPagesLastModified,
      changeFrequency: "yearly" as const,
      priority: 0.8,
    },
    {
      url: new URL("/terms-of-service", baseUrl).toString(),
      lastModified: staticPagesLastModified,
      changeFrequency: "yearly" as const,
      priority: 0.8,
    },
  ];

  // Dynamic agent pages with real lastModified dates
  const agentPages = publicOnlineAgents.map((agent) => ({
    url: new URL(`/agents/${agent.id}`, baseUrl).toString(),
    lastModified: agent.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.64,
  }));

  return [...staticPages, ...agentPages];
}
