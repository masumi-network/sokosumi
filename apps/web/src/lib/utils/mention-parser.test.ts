import { describe, expect, it } from "vitest";

import { formatMentionsAsMarkdownLinks } from "@/lib/utils/mention-parser";

describe("formatMentionsAsMarkdownLinks", () => {
  it("escapes markdown in human names so they cannot become links", () => {
    const userId = "user-1";
    const formatted = formatMentionsAsMarkdownLinks(
      `@${userId}`,
      new Map(),
      new Map([[userId, "[Open](https://example.com)"]]),
    );

    expect(formatted).toBe("@\\[Open\\]\\(https://example\\.com\\)");
  });

  it("leaves agent mention links unchanged", () => {
    const agentId = "agent-1";
    const formatted = formatMentionsAsMarkdownLinks(
      `@${agentId}`,
      new Map([[agentId, "Helper"]]),
      new Map([[agentId, "[Open](https://example.com)"]]),
    );

    expect(formatted).toBe("[@Helper](/agents/agent-1/jobs)");
  });
});
