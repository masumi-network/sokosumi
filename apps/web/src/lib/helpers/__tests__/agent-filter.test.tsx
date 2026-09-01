import { describe, expect, it } from "vitest";
import type { GalleryFilterState } from "@/hooks/use-gallery-filter";
import type { CatalogBrowseAgent } from "@/lib/agents/catalog-browse-agent";
import { SPECIAL_AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";

import { filterAgents } from "../agent-filter";
import { createMockCatalogBrowseAgent } from "./fixtures/catalog-browse-agent";

// Helper function to create mock category
function createMockCategory(slug: string, name: string) {
  return {
    id: `category-${Math.random().toString(36).substring(7)}`,
    name,
    slug,
    description: null,
    image: null,
    icon: null,
    styles: null,
    priority: 0,
  };
}

// Helper function to create mock agents
function createMockAgent(
  overrides: Partial<CatalogBrowseAgent> = {},
): CatalogBrowseAgent {
  return createMockCatalogBrowseAgent(overrides);
}

describe("filterAgents", () => {
  // Test case 1: No filters - should return all agents
  it("should return all agents when no query and no categories provided", () => {
    const agents = [
      createMockAgent({ name: "Agent 1" }),
      createMockAgent({ name: "Agent 2" }),
      createMockAgent({ name: "Agent 3" }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: [],
      kind: "all",
    };
    const result = filterAgents(agents, filterState);
    expect(result).toEqual(agents);
  });

  // Test case 2: Query filtering - should filter by name
  it("should filter agents by name when query is provided", () => {
    const agents = [
      createMockAgent({ name: "Alpha Agent" }),
      createMockAgent({ name: "Beta Agent" }),
      createMockAgent({ name: "Gamma Agent" }),
    ];
    const filterState: GalleryFilterState = {
      query: "Alpha",
      categories: [],
      kind: "all",
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alpha Agent");
  });

  // Test case 3: Query filtering - should filter by description
  it("should filter agents by description when query is provided", () => {
    const agents = [
      createMockAgent({
        name: "Agent 1",
        description: "This agent helps with coding",
      }),
      createMockAgent({
        name: "Agent 2",
        description: "This agent helps with design",
      }),
      createMockAgent({
        name: "Agent 3",
        description: "This agent helps with writing",
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "coding",
      categories: [],
      kind: "all",
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Agent 1");
  });

  // Test case 4: Query filtering - should be case insensitive
  it("should perform case-insensitive query matching", () => {
    const agents = [
      createMockAgent({ name: "Alpha Agent" }),
      createMockAgent({ name: "BETA AGENT" }),
      createMockAgent({ name: "gamma agent" }),
    ];
    const filterState: GalleryFilterState = {
      query: "ALPHA",
      categories: [],
      kind: "all",
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alpha Agent");
  });

  // Test case 5: Query filtering - should trim whitespace
  it("should trim whitespace from query before filtering", () => {
    const agents = [
      createMockAgent({ name: "Alpha Agent" }),
      createMockAgent({ name: "Beta Agent" }),
    ];
    const filterState: GalleryFilterState = {
      query: "  Alpha  ",
      categories: [],
      kind: "all",
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alpha Agent");
  });

  // Test case 6: Category filtering - should filter by regular category slug
  it("should filter agents by regular category slug", () => {
    const agents = [
      createMockAgent({
        name: "Agent 1",
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Agent 2",
        categories: [createMockCategory("design", "Design")],
      }),
      createMockAgent({
        name: "Agent 3",
        categories: [createMockCategory("coding", "Coding")],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: ["coding"],
      kind: "all",
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual(["Agent 1", "Agent 3"]);
  });

  // Test case 7: Category filtering - Featured category
  it("should filter agents by Featured category", () => {
    const agents = [
      createMockAgent({
        name: "Featured Agent",
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED, "Featured"),
        ],
      }),
      createMockAgent({
        name: "Regular Agent",
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Another Featured",
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED, "Featured"),
        ],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: [SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED],
      kind: "all",
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual([
      "Featured Agent",
      "Another Featured",
    ]);
  });

  // Test case 8: Category filtering - New category
  it("should filter agents by New category", () => {
    const agents = [
      createMockAgent({
        name: "New Agent",
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.NEW, "New"),
        ],
      }),
      createMockAgent({
        name: "Old Agent",
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Another New",
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.NEW, "New"),
        ],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: [SPECIAL_AGENT_CATEGORY_SLUGS.NEW],
      kind: "all",
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual(["New Agent", "Another New"]);
  });

  // Test case 9: Category filtering - Others category
  it("should filter agents by Others category", () => {
    // 30 days ago
    const agents = [
      createMockAgent({
        name: "Other Agent",
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT, "Others"),
        ],
      }),
      createMockAgent({
        name: "Featured Agent",
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED, "Featured"),
        ],
      }),
      createMockAgent({
        name: "Categorized Agent",
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Another Other",
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT, "Others"),
        ],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: [SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT],
      kind: "all",
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual(["Other Agent", "Another Other"]);
  });

  // Test case 10: Multiple categories - should match any selected category
  it("should return agents matching any of the selected categories", () => {
    const agents = [
      createMockAgent({
        name: "Coding Agent",
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Design Agent",
        categories: [createMockCategory("design", "Design")],
      }),
      createMockAgent({
        name: "Writing Agent",
        categories: [createMockCategory("writing", "Writing")],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: ["coding", "design"],
      kind: "all",
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual(["Coding Agent", "Design Agent"]);
  });

  // Test case 11: Combined query and category filtering
  it("should filter by both query and categories", () => {
    const agents = [
      createMockAgent({
        name: "Alpha Coding",
        description: "Coding helper",
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Beta Coding",
        description: "Another coding helper",
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Alpha Design",
        description: "Design helper",
        categories: [createMockCategory("design", "Design")],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "Alpha",
      categories: ["coding"],
      kind: "all",
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alpha Coding");
  });

  // Test case 12: Empty query with categories - should only filter by categories
  it("should filter only by categories when query is empty", () => {
    const agents = [
      createMockAgent({
        name: "Agent 1",
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Agent 2",
        categories: [createMockCategory("design", "Design")],
      }),
      createMockAgent({
        name: "Agent 3",
        categories: [createMockCategory("coding", "Coding")],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: ["coding"],
      kind: "all",
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual(["Agent 1", "Agent 3"]);
  });

  // Test case 13: Query with no categories - should only filter by query
  it("should filter only by query when no categories selected", () => {
    const agents = [
      createMockAgent({ name: "Alpha Agent" }),
      createMockAgent({ name: "Beta Agent" }),
      createMockAgent({ name: "Alpha Beta" }),
    ];
    const filterState: GalleryFilterState = {
      query: "Alpha",
      categories: [],
      kind: "all",
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual(["Alpha Agent", "Alpha Beta"]);
  });

  // Test case 14: Featured agent should not appear in Others (they have different categories)
  it("should not return featured agents when filtering by Others", () => {
    const agents = [
      createMockAgent({
        name: "Featured Agent",
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.FEATURED, "Featured"),
        ],
      }),
      createMockAgent({
        name: "Other Agent",
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT, "Others"),
        ],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: [SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT],
      kind: "all",
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Other Agent");
  });

  // Test case 15: New agent should not appear in Others (they have different categories)
  it("should not return agents with different categories when filtering by Others", () => {
    const agents = [
      createMockAgent({
        name: "New Agent",
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.NEW, "New"),
        ],
      }),
      createMockAgent({
        name: "Other Agent",
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT, "Others"),
        ],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: [SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT],
      kind: "all",
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Other Agent");
  });

  // Test case 16: Agent with regular category should not appear when filtering by Others
  it("should not return agents with regular categories when filtering by Others", () => {
    const agents = [
      createMockAgent({
        name: "Categorized Agent",
        categories: [createMockCategory("coding", "Coding")],
      }),
      createMockAgent({
        name: "Other Agent",
        categories: [
          createMockCategory(SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT, "Others"),
        ],
      }),
    ];
    const filterState: GalleryFilterState = {
      query: "",
      categories: [SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT],
      kind: "all",
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Other Agent");
  });

  // Test case 17: Edge case - null description handling
  it("should handle agents with null description", () => {
    const agents = [
      createMockAgent({ name: "Agent 1", description: "" }),
      createMockAgent({ name: "Agent 2", description: "Has description" }),
    ];
    const filterState: GalleryFilterState = {
      query: "Agent",
      categories: [],
      kind: "all",
    };
    const result = filterAgents(agents, filterState);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toEqual(["Agent 1", "Agent 2"]);
  });
});

it("filters by kind when Cardano is selected", () => {
  const agents = [
    createMockAgent({ name: "Cardano Agent", kind: "cardano" }),
    createMockAgent({ name: "x402 Agent", kind: "x402" }),
  ];
  const filterState: GalleryFilterState = {
    query: "",
    categories: [],
    kind: "cardano",
  };
  const result = filterAgents(agents, filterState);
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("Cardano Agent");
});

it("ignores category filters when kind is x402 only", () => {
  const agents = [
    createMockAgent({
      name: "x402 Agent",
      kind: "x402",
      categories: [],
    }),
    createMockAgent({
      name: "Cardano Agent",
      kind: "cardano",
      categories: [createMockCategory("writing", "Writing")],
    }),
  ];
  const filterState: GalleryFilterState = {
    query: "",
    categories: ["writing"],
    kind: "x402",
  };
  const result = filterAgents(agents, filterState);
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("x402 Agent");
});
