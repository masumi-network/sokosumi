import { describe, expect, it } from "vitest";
import { getAgentCategoryStyles } from "@/lib/helpers/agent";

import { createMockCoreAgent } from "./__tests__/fixtures/core-agent";

const DEFAULT_CATEGORY_STYLES = {
  light: { color: "text-default-foreground" },
  dark: { color: "text-default-foreground" },
};

describe("getAgentCategoryStyles", () => {
  it("returns styles from the highest-priority category", () => {
    const styles = {
      light: { color: "text-blue-600" },
      dark: { color: "text-blue-400" },
    };
    const agent = createMockCoreAgent({
      categories: [
        {
          id: "cat-1",
          name: "Coding",
          slug: "coding",
          description: null,
          image: null,
          icon: null,
          priority: 1,
          styles,
        },
      ],
    });

    expect(getAgentCategoryStyles(agent)).toEqual(styles);
  });

  it("returns default styles when agent has no categories", () => {
    const agent = createMockCoreAgent({ categories: [] });
    expect(getAgentCategoryStyles(agent)).toEqual(DEFAULT_CATEGORY_STYLES);
  });

  it("returns default styles when category has no styles field", () => {
    const agent = createMockCoreAgent({
      categories: [
        {
          id: "cat-1",
          name: "Coding",
          slug: "coding",
          description: null,
          image: null,
          icon: null,
          priority: 1,
          styles: null,
        },
      ],
    });

    expect(getAgentCategoryStyles(agent)).toEqual(DEFAULT_CATEGORY_STYLES);
  });
});
