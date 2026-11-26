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

  it("keeps a long Task's name and status, so the reply can still show the read", () => {
    const stored = persistedToolResult({
      id: "task",
      name: "App UX: home",
      status: "COMPLETED",
      events: [{ comment: "x".repeat(25_000) }],
    });
    expect(stored).toMatchObject({
      truncated: true,
      id: "task",
      name: "App UX: home",
      status: "COMPLETED",
    });
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

  it("keeps handed-back ids whole only on a month writer receipt", () => {
    const receipt = {
      handedBack: ["p1", "p2"],
      refused: Array.from({ length: 30 }, () => ({ reason: "x".repeat(800) })),
    };
    expect(
      (
        persistedToolResult(receipt, "write_month_pieces") as never as {
          handedBack: string[];
        }
      ).handedBack,
    ).toEqual(["p1", "p2"]);
    expect(persistedToolResult(receipt, "read_calendar")).not.toHaveProperty(
      "handedBack",
    );
  });

  it("stays within 16 KB when the handed-back ids alone would not fit", () => {
    const ids = Array.from(
      { length: 100 },
      (_, n) => `${n}-${"é".repeat(200)}`,
    );
    const stored = persistedToolResult(
      { handedBack: ids, refused: [] },
      "write_month_pieces",
    ) as never as { handedBack: string[]; preview: string };

    expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThanOrEqual(
      16_384,
    );
    expect(stored.handedBack.length).toBeGreaterThan(0);
    expect(stored.handedBack.length).toBeLessThan(100);
    expect(stored.handedBack).toEqual(ids.slice(0, stored.handedBack.length));
  });

  it("stores a small result as it is", () => {
    expect(persistedToolResult({ url: "https://example.com/a" })).toEqual({
      url: "https://example.com/a",
    });
  });

  it("keeps canonicalInputHash within the 16 KB audit limit when clipping a long create_task input", () => {
    const hash = "a".repeat(64);
    const stored = persistedToolResult(
      {
        name: "Long brief",
        coworkerId: null,
        description: "x".repeat(18_000),
      },
      "create_task",
      { canonicalInputHash: hash },
    );
    expect(stored).toMatchObject({
      truncated: true,
      name: "Long brief",
      canonicalInputHash: hash,
    });
    expect(
      Buffer.byteLength(JSON.stringify(stored), "utf8"),
    ).toBeLessThanOrEqual(16_384);
    // Unclipped inputs stay unmodified.
    expect(
      persistedToolResult({ name: "Short" }, "create_task", {
        canonicalInputHash: hash,
      }),
    ).toEqual({ name: "Short" });
  });
});
