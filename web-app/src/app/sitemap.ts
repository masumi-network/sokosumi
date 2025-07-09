import type { MetadataRoute } from "next";

import { getOnlineAgentsWithCreditsPrice } from "@/lib/services";

const baseUrl = "https://sokosumi.com";
const staticPagesLastModified = new Date("2025-07-08T14:47:50+00:00");

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Fetch agents from database to get real lastModified dates
  const agentsWithPrice = await getOnlineAgentsWithCreditsPrice();

  // Static pages with appropriate lastModified dates
  const staticPages = [
    {
      url: `${baseUrl}/`,
      lastModified: staticPagesLastModified,
      changeFrequency: "yearly" as const,
      priority: 1,
    },
    {
      url: `${baseUrl}/agents`,
      lastModified: staticPagesLastModified,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    },
    {
      url: `${baseUrl}/login`,
      lastModified: staticPagesLastModified,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    },
    {
      url: `${baseUrl}/register`,
      lastModified: staticPagesLastModified,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    },
    {
      url: `${baseUrl}/forgot-password`,
      lastModified: staticPagesLastModified,
      changeFrequency: "monthly" as const,
      priority: 0.64,
    },
    {
      url: `${baseUrl}/imprint`,
      lastModified: staticPagesLastModified,
      changeFrequency: "yearly" as const,
      priority: 0.8,
    },
    {
      url: `${baseUrl}/privacy-policy`,
      lastModified: staticPagesLastModified,
      changeFrequency: "yearly" as const,
      priority: 0.8,
    },
    {
      url: `${baseUrl}/terms-of-service`,
      lastModified: staticPagesLastModified,
      changeFrequency: "yearly" as const,
      priority: 0.8,
    },
  ];

  // Dynamic agent pages with real lastModified dates
  const agentPages = agentsWithPrice.map(({ agent }) => ({
    url: `${baseUrl}/agents/${agent.id}`,
    lastModified: agent.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.64,
  }));

  return [...staticPages, ...agentPages];
}
