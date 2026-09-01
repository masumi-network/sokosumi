import type { CatalogBrowseAgent } from "@/lib/agents/catalog-browse-agent";

export function createMockCatalogBrowseAgent(
  overrides: Partial<CatalogBrowseAgent> = {},
): CatalogBrowseAgent {
  return {
    id: `agent-${Math.random().toString(36).slice(2)}`,
    kind: "cardano",
    name: "Test Agent",
    description: "Test description",
    summary: null,
    image: "https://example.com/image.png",
    icon: null,
    categories: [],
    metrics: {
      executions: { count: 0, averageTime: null },
      ratings: { total: 0, average: null },
    },
    author: {
      name: "Test Author",
      image: null,
      organization: null,
      other: null,
    },
    externalUrl: null,
    ...overrides,
  };
}
