import { describe, expect, it } from "vitest";
import { getAgentCategoryStyles } from "@/lib/helpers/agent";
import type { CoreAgentDto } from "@/lib/types/core-dto";

import { createMockCoreAgent } from "./fixtures/core-agent";

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

  it("returns undefined when agent has no categories", () => {
    const agent = createMockCoreAgent({ categories: [] });
    expect(getAgentCategoryStyles(agent)).toBeUndefined();
  });

  it("returns undefined when first category has no styles", () => {
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
        },
      ],
    } as Partial<CoreAgentDto>);

    expect(getAgentCategoryStyles(agent)).toBeUndefined();
  });
});
