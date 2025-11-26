import type { AgentWithCategories } from "@sokosumi/database";

import { getAgentCategoryStyles } from "@/lib/helpers/agent";
import type { CategoryStyles } from "@/lib/types/category";

function createMockAgent(
  overrides: Partial<AgentWithCategories> = {},
): AgentWithCategories {
  const now = new Date();
  return {
    id: `agent-${Math.random().toString(36).substring(7)}`,
    createdAt: now,
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
    status: "ONLINE",
    isShown: true,
    riskClassification: "MINIMAL",
    summary: null,
    demoInput: null,
    demoOutput: null,
    categories: [],
    ...overrides,
  };
}

describe("getAgentCategoryStyles", () => {
  it("should parse valid category styles JSON string", () => {
    const validStyles: CategoryStyles = {
      light: {
        color: "text-blue-600",
      },
      dark: {
        color: "text-blue-400",
      },
    };
    const agent = createMockAgent({
      categories: [
        {
          id: "cat-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          name: "Coding",
          slug: "coding",
          description: null,
          image: null,
          styles: JSON.stringify(validStyles),
          priority: 1,
        },
      ],
    });
    const result = getAgentCategoryStyles(agent);
    expect(result).toEqual(validStyles);
  });

  it("should handle styles as object (not JSON string)", () => {
    const validStyles: CategoryStyles = {
      light: {
        color: "text-green-600",
      },
      dark: {
        color: "text-green-400",
      },
    };
    const agent = createMockAgent({
      categories: [
        {
          id: "cat-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          name: "Design",
          slug: "design",
          description: null,
          image: null,
          styles: validStyles as never,
          priority: 1,
        },
      ],
    });
    const result = getAgentCategoryStyles(agent);
    expect(result).toEqual(validStyles);
  });

  it("should return default styles when JSON is invalid", () => {
    const agent = createMockAgent({
      categories: [
        {
          id: "cat-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          name: "Invalid",
          slug: "invalid",
          description: null,
          image: null,
          styles: "{ invalid json }",
          priority: 1,
        },
      ],
    });
    const result = getAgentCategoryStyles(agent);
    expect(result).toEqual({
      light: {
        color: "text-default-foreground",
      },
      dark: {
        color: "text-default-foreground",
      },
    });
  });

  it("should return default styles when parsed structure is invalid", () => {
    const invalidStyles = {
      light: {
        color: "text-blue-600",
        border: {
          gradient: {
            type: "linear",
            stops: [], // Invalid: stops array is empty (should have at least 1)
          },
        },
      },
    };
    const agent = createMockAgent({
      categories: [
        {
          id: "cat-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          name: "Invalid",
          slug: "invalid",
          description: null,
          image: null,
          styles: JSON.stringify(invalidStyles),
          priority: 1,
        },
      ],
    });
    const result = getAgentCategoryStyles(agent);
    expect(result).toEqual({
      light: {
        color: "text-default-foreground",
      },
      dark: {
        color: "text-default-foreground",
      },
    });
  });

  it("should return default styles when agent has no categories", () => {
    const agent = createMockAgent({
      categories: [],
    });
    const result = getAgentCategoryStyles(agent);
    expect(result).toEqual({
      light: {
        color: "text-default-foreground",
      },
      dark: {
        color: "text-default-foreground",
      },
    });
  });

  it("should return default styles when category has no styles property", () => {
    const agent = createMockAgent({
      categories: [
        {
          id: "cat-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          name: "No Styles",
          slug: "no-styles",
          description: null,
          image: null,
          styles: null,
          priority: 1,
        },
      ],
    });
    const result = getAgentCategoryStyles(agent);
    expect(result).toEqual({
      light: {
        color: "text-default-foreground",
      },
      dark: {
        color: "text-default-foreground",
      },
    });
  });

  it("should return styles with light theme when available", () => {
    const validStyles: CategoryStyles = {
      light: {
        color: "text-purple-600",
      },
    };
    const agent = createMockAgent({
      categories: [
        {
          id: "cat-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          name: "Light Theme",
          slug: "light-theme",
          description: null,
          image: null,
          styles: JSON.stringify(validStyles),
          priority: 1,
        },
      ],
    });
    const result = getAgentCategoryStyles(agent);
    expect(result).toEqual(validStyles);
    expect(result.light?.color).toBe("text-purple-600");
  });

  it("should return styles with dark theme when available", () => {
    const validStyles: CategoryStyles = {
      dark: {
        color: "text-yellow-400",
      },
    };
    const agent = createMockAgent({
      categories: [
        {
          id: "cat-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          name: "Dark Theme",
          slug: "dark-theme",
          description: null,
          image: null,
          styles: JSON.stringify(validStyles),
          priority: 1,
        },
      ],
    });
    const result = getAgentCategoryStyles(agent);
    expect(result).toEqual(validStyles);
    expect(result.dark?.color).toBe("text-yellow-400");
  });

  it("should use styles from first category that has styles property", () => {
    const firstStyles: CategoryStyles = {
      light: {
        color: "text-first-600",
      },
    };
    const secondStyles: CategoryStyles = {
      light: {
        color: "text-second-600",
      },
    };
    const agent = createMockAgent({
      categories: [
        {
          id: "cat-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          name: "First",
          slug: "first",
          description: null,
          image: null,
          styles: null, // No styles
          priority: 1,
        },
        {
          id: "cat-2",
          createdAt: new Date(),
          updatedAt: new Date(),
          name: "Second",
          slug: "second",
          description: null,
          image: null,
          styles: JSON.stringify(firstStyles), // First with styles
          priority: 1,
        },
        {
          id: "cat-3",
          createdAt: new Date(),
          updatedAt: new Date(),
          name: "Third",
          slug: "third",
          description: null,
          image: null,
          styles: JSON.stringify(secondStyles), // Second with styles, but should be ignored
          priority: 1,
        },
      ],
    });
    const result = getAgentCategoryStyles(agent);
    expect(result).toEqual(firstStyles);
    expect(result.light?.color).toBe("text-first-600");
  });

  it("should validate styles structure using Zod schema", () => {
    const validStyles: CategoryStyles = {
      light: {
        color: "text-indigo-600",
        border: {
          gradient: {
            type: "linear",
            angle: 135,
            stops: [
              { color: "#4f46e5", offset: 0 },
              { color: "#312e81", offset: 1, opacity: 0.8 },
            ],
          },
        },
      },
      dark: {
        color: "text-indigo-400",
      },
    };
    const agent = createMockAgent({
      categories: [
        {
          id: "cat-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          name: "Valid",
          slug: "valid",
          description: null,
          image: null,
          styles: JSON.stringify(validStyles),
          priority: 1,
        },
      ],
    });
    const result = getAgentCategoryStyles(agent);
    expect(result).toEqual(validStyles);
    expect(result.light?.border?.gradient?.stops).toHaveLength(2);
  });

  it("should return default styles when Zod validation fails", () => {
    const invalidStyles = {
      light: {
        color: "text-red-600",
        border: {
          gradient: {
            type: "linear",
            // Missing required 'stops' array
          },
        },
      },
    };
    const agent = createMockAgent({
      categories: [
        {
          id: "cat-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          name: "Invalid",
          slug: "invalid",
          description: null,
          image: null,
          styles: JSON.stringify(invalidStyles),
          priority: 1,
        },
      ],
    });
    const result = getAgentCategoryStyles(agent);
    expect(result).toEqual({
      light: {
        color: "text-default-foreground",
      },
      dark: {
        color: "text-default-foreground",
      },
    });
  });

  it("should return default styles when categories array is empty", () => {
    const agent = createMockAgent({
      categories: [],
    });
    const result = getAgentCategoryStyles(agent);
    expect(result).toEqual({
      light: {
        color: "text-default-foreground",
      },
      dark: {
        color: "text-default-foreground",
      },
    });
  });

  it("should return default styles when categories is null", () => {
    const agent = createMockAgent({
      categories: null as unknown as [],
    });
    const result = getAgentCategoryStyles(agent);
    expect(result).toEqual({
      light: {
        color: "text-default-foreground",
      },
      dark: {
        color: "text-default-foreground",
      },
    });
  });
});
