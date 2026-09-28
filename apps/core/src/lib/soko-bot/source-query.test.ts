import { describe, expect, it } from "vitest";
import { readSokoBotSource } from "./source-query";

describe("source query coverage", () => {
  it("distinguishes disconnected, failed and available empty queries", async () => {
    const scope = {
      source: "CALENDAR",
      filters: { from: "2026-09-26", to: "2026-09-27" },
    };
    expect(
      (await readSokoBotSource({ ...scope, queries: [] })).coverage,
    ).toMatchObject({
      availability: "DISCONNECTED",
      completeness: "NOT_CHECKED",
    });
    expect(
      (
        await readSokoBotSource({
          ...scope,
          queries: [
            async () => {
              throw new Error("private provider error");
            },
          ],
        })
      ).coverage,
    ).toMatchObject({
      availability: "QUERY_FAILED",
      completeness: "NOT_CHECKED",
    });
    const empty = await readSokoBotSource({
      ...scope,
      queries: [async () => []],
    });
    expect(empty.coverage).toMatchObject({
      availability: "AVAILABLE",
      completeness: "TRUNCATED",
      scannedCount: 0,
    });
  });
  it("keeps partial evidence without claiming completeness or returning private errors", async () => {
    const result = await readSokoBotSource({
      source: "MAIL",
      filters: { query: "meeting" },
      queries: [
        async () => ["message"],
        async () => {
          throw new Error("secret");
        },
      ],
    });
    expect(result.rows).toEqual(["message"]);
    expect(result.failedSources).toBe(1);
    expect(result.coverage.completeness).toBe("TRUNCATED");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
