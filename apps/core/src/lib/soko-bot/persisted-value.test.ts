import { describe, expect, it } from "vitest";

import { citationsIn } from "./citations";
import { persistedToolResult } from "./persisted-value";

describe("persistedToolResult", () => {
  it("drops NUL and lone surrogates Postgres jsonb refuses", () => {
    const stored = JSON.stringify(
      persistedToolResult({
        messages: [{ snippet: "a\u0000b \ud83d tail" }],
      }),
    );
    expect(stored).not.toMatch(/\\u0000|\\ud83d/);
    expect(stored).toContain("ab");
  });

  it("never cuts an emoji in half when truncating", () => {
    const long = "😀".repeat(20_000);
    const stored = JSON.stringify(persistedToolResult({ text: long }));
    expect(stored).not.toMatch(/\\ud83d"/);
    expect(JSON.parse(stored).truncated).toBe(true);
  });

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

  it("keeps a long Social post's projectId for result cards and post links", () => {
    const stored = persistedToolResult({
      id: "post",
      projectId: "project",
      text: "x".repeat(25_000),
    });
    expect(stored).toMatchObject({ truncated: true, projectId: "project" });
    expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThanOrEqual(
      16_384,
    );
  });

  it("stores a small result as it is", () => {
    expect(persistedToolResult({ url: "https://example.com/a" })).toEqual({
      url: "https://example.com/a",
    });
  });
});
