import { describe, expect, it } from "vitest";

import { citationsIn } from "./citations";
import { persistedToolResult } from "./persisted-value";

describe("persistedToolResult", () => {
  it("keeps the addresses of a result too large to store whole", () => {
    const tasks = Array.from({ length: 25 }, (_, index) => ({
      id: `task-${index}`,
      latest: {
        comment: `${"Research notes. ".repeat(60)} Source: https://example.com/report-${index}`,
      },
    }));
    const stored = persistedToolResult({ tasks, total: 25 });
    expect(stored).toMatchObject({ truncated: true });
    expect(citationsIn(stored)).toContain("example.com/report-24");
  });

  it("stores a small result as it is", () => {
    expect(persistedToolResult({ url: "https://example.com/a" })).toEqual({
      url: "https://example.com/a",
    });
  });
});
