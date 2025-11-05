import type { AgentWithCreditsPrice } from "@sokosumi/database";
import { AgentStatus } from "@sokosumi/database";

import {
  SPECIAL_AGENT_CATEGORY_SLUGS,
  SYNTHETIC_DEFAULT_CATEGORY,
} from "@/lib/constants/agent-categories";
import type { Category } from "@/lib/types/category";

import { groupAgentsByCategory } from "../agent-grouping";

// Helper function to create mock Prisma Category for agent.categories field
function createMockPrismaCategory(
  slug: string,
  name: string,
  priority: number = 0,
) {
  const now = new Date();
  return {
    id: `category-${Math.random().toString(36).substring(7)}`,
    createdAt: now,
    updatedAt: now,
    name,
    slug,
    description: null,
    image: null,
    styles: null,
    priority,
  };
}

// Helper function to create mock agents
function createMockAgent(
  overrides: Partial<AgentWithCreditsPrice> = {},
): AgentWithCreditsPrice {
  const now = new Date();
  const oldDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

  const createdAt = overrides.createdAt ?? oldDate;

  return {
    id: `agent-${Math.random().toString(36).substring(7)}`,
    createdAt,
    updatedAt: now,
    blockchainIdentifier: `blockchain-${Math.random().toString(36).substring(7)}`,
    name: "Test Agent",
    overrideName: null,
    description: "Test description",
    overrideDescription: null,
    apiBaseUrl: "https://api.example.com",
    overrideApiBaseUrl: null,
    capabilityName: "test-capability",
    overrideCapabilityName: null,
    capabilityVersion: "1.0.0",
    overrideCapabilityVersion: null,
    authorName: "Test Author",
    overrideAuthorName: null,
    authorImage: null,
    overrideAuthorImage: null,
    authorContactEmail: null,
    overrideAuthorContactEmail: null,
    authorContactOther: null,
    overrideAuthorContactOther: null,
    authorOrganization: null,
    overrideAuthorOrganization: null,
    legalPrivacyPolicy: null,
    overrideLegalPrivacyPolicy: null,
    legalTerms: null,
    overrideLegalTerms: null,
    legalOther: null,
    overrideLegalOther: null,
    lastUptimeCheck: now,
    uptimeCount: 100,
    uptimeCheckCount: 100,
    image: "https://example.com/image.png",
    overrideImage: null,
    icon: null,
    metadataVersion: 1,
    paymentType: "WEB3_CARDANO_V1",
    pricingId: "pricing-1",
    pricing: {
      id: "pricing-1",
      createdAt: now,
      updatedAt: now,
      pricingType: "FREE",
      agentFixedPricingId: null,
      fixedPricing: null,
    },
    status: AgentStatus.ONLINE,
    isShown: true,
    riskClassification: "MINIMAL",
    summary: null,
    demoInput: null,
    demoOutput: null,
    tags: [],
    overrideTags: [],
    categories: [],
    exampleOutput: [],
    overrideExampleOutput: [],
    userAgentRating: [],
    organizations: [],
    blacklistedOrganizations: [],
    creditsPrice: {
      cents: BigInt(0),
      includedFee: BigInt(0),
    },
    ...overrides,
  } as AgentWithCreditsPrice;
}

describe("groupAgentsByCategory", () => {
  // Test case 1: Basic grouping - agents should be grouped by their categories
  it("should group agents by their categories", () => {
    const agents = [
      createMockAgent({
        name: "Coding Agent",
        categories: [createMockPrismaCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Design Agent",
        categories: [createMockPrismaCategory("design", "Design")],
      }),
      createMockAgent({
        name: "Another Coding",
        categories: [createMockPrismaCategory("coding", "Coding")],
      }),
    ];
    const categories: Category[] = [
      { slug: "coding", name: "Coding", priority: 10 },
      { slug: "design", name: "Design", priority: 20 },
    ];
    const result = groupAgentsByCategory(agents, categories);
    expect(result).toHaveLength(2);
    expect(result[0].categorySlug).toBe("coding");
    expect(result[0].agents).toHaveLength(2);
    expect(result[1].categorySlug).toBe("design");
    expect(result[1].agents).toHaveLength(1);
  });

  // Test case 2: Priority ordering - Featured should come first, then New, then regular categories, then Others
  it("should maintain priority order: Featured → New → Regular → Others", () => {
    const newDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const agents = [
      createMockAgent({
        name: "Featured Agent",
        createdAt: oldDate,
        categories: [
          createMockPrismaCategory(
            SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED,
            "Featured",
          ),
        ],
      }),
      createMockAgent({
        name: "New Agent",
        createdAt: newDate,
        categories: [
          createMockPrismaCategory(SPECIAL_AGENT_CATEGORY_SLUGS.NEW, "New"),
        ],
      }),
      createMockAgent({
        name: "Regular Agent",
        createdAt: oldDate,
        categories: [createMockPrismaCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Other Agent",
        createdAt: oldDate,
        categories: [
          createMockPrismaCategory(
            SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT,
            "Others",
          ),
        ],
      }),
    ];
    const categories: Category[] = [
      {
        slug: SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED,
        name: "Featured",
        priority: 1,
      },
      { slug: SPECIAL_AGENT_CATEGORY_SLUGS.NEW, name: "New", priority: 2 },
      { slug: "coding", name: "Coding", priority: 10 },
      { ...SYNTHETIC_DEFAULT_CATEGORY },
    ];
    const result = groupAgentsByCategory(agents, categories);
    expect(result).toHaveLength(4);
    expect(result[0].categorySlug).toBe(SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED);
    expect(result[1].categorySlug).toBe(SPECIAL_AGENT_CATEGORY_SLUGS.NEW);
    expect(result[2].categorySlug).toBe("coding");
    expect(result[3].categorySlug).toBe(SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT);
  });

  // Test case 3: Multi-category agents - agents can appear in multiple groups
  it("should allow agents to appear in multiple groups", () => {
    const agents = [
      createMockAgent({
        name: "Featured New Agent",
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        categories: [
          createMockPrismaCategory(
            SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED,
            "Featured",
          ),
          createMockPrismaCategory(SPECIAL_AGENT_CATEGORY_SLUGS.NEW, "New"),
        ],
      }),
    ];
    const categories: Category[] = [
      {
        slug: SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED,
        name: "Featured",
        priority: 1,
      },
      { slug: SPECIAL_AGENT_CATEGORY_SLUGS.NEW, name: "New", priority: 2 },
    ];
    const result = groupAgentsByCategory(agents, categories);
    expect(result).toHaveLength(2); // Featured and New
    const featuredGroup = result.find(
      (g) => g.categorySlug === SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED,
    );
    const newGroup = result.find(
      (g) => g.categorySlug === SPECIAL_AGENT_CATEGORY_SLUGS.NEW,
    );
    expect(featuredGroup?.agents).toHaveLength(1);
    expect(newGroup?.agents).toHaveLength(1);
    expect(featuredGroup?.agents[0].name).toBe("Featured New Agent");
    expect(newGroup?.agents[0].name).toBe("Featured New Agent");
  });

  // Test case 4: Featured + New + Regular category combination
  it("should handle agents with Featured + New + regular category", () => {
    const agents = [
      createMockAgent({
        name: "Multi Category Agent",
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        categories: [
          createMockPrismaCategory(
            SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED,
            "Featured",
          ),
          createMockPrismaCategory(SPECIAL_AGENT_CATEGORY_SLUGS.NEW, "New"),
          createMockPrismaCategory("coding", "Coding"),
        ],
      }),
    ];
    const categories: Category[] = [
      {
        slug: SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED,
        name: "Featured",
        priority: 1,
      },
      { slug: SPECIAL_AGENT_CATEGORY_SLUGS.NEW, name: "New", priority: 2 },
      { slug: "coding", name: "Coding", priority: 10 },
    ];
    const result = groupAgentsByCategory(agents, categories);
    expect(result).toHaveLength(3); // Featured, New, and Coding
    const featuredGroup = result.find(
      (g) => g.categorySlug === SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED,
    );
    const newGroup = result.find(
      (g) => g.categorySlug === SPECIAL_AGENT_CATEGORY_SLUGS.NEW,
    );
    const codingGroup = result.find((g) => g.categorySlug === "coding");
    expect(featuredGroup?.agents).toHaveLength(1);
    expect(newGroup?.agents).toHaveLength(1);
    expect(codingGroup?.agents).toHaveLength(1);
  });

  // Test case 5: Empty inputs - should handle empty agent array
  it("should return empty array when no agents provided", () => {
    const agents: AgentWithCreditsPrice[] = [];
    const categories: Category[] = [
      { slug: "category-1", name: "Category 1", priority: 0 },
    ];
    const result = groupAgentsByCategory(agents, categories);
    expect(result).toEqual([]);
  });

  // Test case 6: Empty categories - should handle empty category array
  it("should handle empty category array", () => {
    const agents = [
      createMockAgent({
        name: "Agent 1",
        categories: [
          createMockPrismaCategory(
            SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT,
            "Others",
          ),
        ],
      }),
      createMockAgent({
        name: "Agent 2",
        categories: [
          createMockPrismaCategory(
            SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT,
            "Others",
          ),
        ],
      }),
    ];
    const categories: Category[] = [];
    const result = groupAgentsByCategory(agents, categories);
    expect(result).toEqual([]);
  });

  // Test case 7: Agents with "Others" category - should be grouped under Others
  it("should group agents with Others category", () => {
    const agents = [
      createMockAgent({
        name: "Agent 1",
        categories: [
          createMockPrismaCategory(
            SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT,
            "Others",
          ),
        ],
      }),
      createMockAgent({
        name: "Agent 2",
        categories: [
          createMockPrismaCategory(
            SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT,
            "Others",
          ),
        ],
      }),
    ];
    const categories: Category[] = [
      { slug: "coding", name: "Coding", priority: 10 },
      { ...SYNTHETIC_DEFAULT_CATEGORY },
    ];
    const result = groupAgentsByCategory(agents, categories);
    const othersGroup = result.find(
      (g) => g.categorySlug === SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT,
    );
    expect(othersGroup).toBeDefined();
    expect(othersGroup?.agents).toHaveLength(2);
  });

  it("should assign agents without categories to the synthetic Others group", () => {
    const agents = [
      createMockAgent({ name: "Agent 1", categories: [] }),
      createMockAgent({ name: "Agent 2", categories: [] }),
    ];

    const categories: Category[] = [{ ...SYNTHETIC_DEFAULT_CATEGORY }];

    const result = groupAgentsByCategory(agents, categories);
    const othersGroup = result.find(
      (g) => g.categorySlug === SYNTHETIC_DEFAULT_CATEGORY.slug,
    );

    expect(othersGroup).toBeDefined();
    expect(othersGroup?.agents).toHaveLength(2);
    expect(othersGroup?.agents.map((agent) => agent.name)).toEqual([
      "Agent 1",
      "Agent 2",
    ]);
  });

  // Test case 8: Category name fallback - should use slug if category name not found
  it("should use slug as fallback when category name not found", () => {
    const agents = [
      createMockAgent({
        name: "Agent 1",
        categories: [createMockPrismaCategory("unknown-category", "Unknown")],
      }),
    ];
    const categories: Category[] = [
      { slug: "coding", name: "Coding", priority: 10 },
    ];
    const result = groupAgentsByCategory(agents, categories);
    // Agent has unknown category that's not in the categories list,
    // so it won't match any category and won't appear in any group.
    expect(result).toEqual([]);
  });

  // Test case 9: Others category name - should use categoryMap
  it("should use categoryMap for Others category name", () => {
    const agents = [
      createMockAgent({
        name: "Agent 1",
        categories: [
          createMockPrismaCategory(
            SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT,
            "Others",
          ),
        ],
      }),
    ];
    const categoriesWithOthers: Category[] = [
      {
        ...SYNTHETIC_DEFAULT_CATEGORY,
        name: "Others Category",
      },
    ];
    const result = groupAgentsByCategory(agents, categoriesWithOthers);
    const othersGroup = result.find(
      (g) => g.categorySlug === SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT,
    );
    expect(othersGroup).toBeDefined();
    expect(othersGroup?.categoryName).toBe("Others Category");
  });

  // Test case 10: Regular categories filtering - all categories are treated equally
  it("should handle all categories from database", () => {
    const agents = [
      createMockAgent({
        name: "Coding Agent",
        categories: [createMockPrismaCategory("coding", "Coding")],
      }),
    ];
    const categories: Category[] = [
      {
        slug: SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED,
        name: "Featured",
        priority: 1,
      },
      { slug: SPECIAL_AGENT_CATEGORY_SLUGS.NEW, name: "New", priority: 2 },
      { ...SYNTHETIC_DEFAULT_CATEGORY },
      { slug: "coding", name: "Coding", priority: 10 },
    ];
    const result = groupAgentsByCategory(agents, categories);
    const codingGroup = result.find((g) => g.categorySlug === "coding");
    expect(codingGroup).toBeDefined();
    expect(codingGroup?.categorySlug).toBe("coding");
  });

  // Test case 11: Edge case - agent with multiple categories should appear in all matching groups
  it("should assign agents with multiple categories to all matching groups", () => {
    const agents = [
      createMockAgent({
        name: "New Coding Agent",
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        categories: [
          createMockPrismaCategory(SPECIAL_AGENT_CATEGORY_SLUGS.NEW, "New"),
          createMockPrismaCategory("coding", "Coding"),
        ],
      }),
    ];
    const categories: Category[] = [
      { slug: SPECIAL_AGENT_CATEGORY_SLUGS.NEW, name: "New", priority: 2 },
      { slug: "coding", name: "Coding", priority: 10 },
    ];
    const result = groupAgentsByCategory(agents, categories);
    const newGroup = result.find(
      (g) => g.categorySlug === SPECIAL_AGENT_CATEGORY_SLUGS.NEW,
    );
    const codingGroup = result.find((g) => g.categorySlug === "coding");
    expect(newGroup?.agents).toHaveLength(1);
    expect(codingGroup?.agents).toHaveLength(1);
    expect(newGroup?.agents[0].name).toBe("New Coding Agent");
    expect(codingGroup?.agents[0].name).toBe("New Coding Agent");
  });

  // Test case 12: Edge case - featured agent that is also new should appear in both Featured and New
  it("should assign featured and new agents to both Featured and New groups", () => {
    const agents = [
      createMockAgent({
        name: "Featured New Agent",
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        categories: [
          createMockPrismaCategory(
            SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED,
            "Featured",
          ),
          createMockPrismaCategory(SPECIAL_AGENT_CATEGORY_SLUGS.NEW, "New"),
        ],
      }),
    ];
    const categories: Category[] = [
      {
        slug: SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED,
        name: "Featured",
        priority: 1,
      },
      { slug: SPECIAL_AGENT_CATEGORY_SLUGS.NEW, name: "New", priority: 2 },
    ];
    const result = groupAgentsByCategory(agents, categories);
    const featuredGroup = result.find(
      (g) => g.categorySlug === SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED,
    );
    const newGroup = result.find(
      (g) => g.categorySlug === SPECIAL_AGENT_CATEGORY_SLUGS.NEW,
    );
    expect(featuredGroup?.agents).toHaveLength(1);
    expect(newGroup?.agents).toHaveLength(1);
    expect(featuredGroup?.agents[0].name).toBe("Featured New Agent");
    expect(newGroup?.agents[0].name).toBe("Featured New Agent");
  });

  // Test case 13: NEW category not in categories list - should not assign to NEW
  it("should not assign to NEW category if agent doesn't have NEW category or it doesn't exist in categories list", () => {
    const agents = [
      createMockAgent({
        name: "Coding Agent",
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        categories: [createMockPrismaCategory("coding", "Coding")],
      }),
    ];
    const categories: Category[] = [
      { slug: "coding", name: "Coding", priority: 10 },
      // NEW category not included
    ];
    const result = groupAgentsByCategory(agents, categories);
    const newGroup = result.find(
      (g) => g.categorySlug === SPECIAL_AGENT_CATEGORY_SLUGS.NEW,
    );
    const codingGroup = result.find((g) => g.categorySlug === "coding");
    expect(newGroup).toBeUndefined();
    expect(codingGroup?.agents).toHaveLength(1);
  });
});
