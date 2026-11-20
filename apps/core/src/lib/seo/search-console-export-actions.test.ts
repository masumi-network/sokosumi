import { expect, it } from "vitest";
import type { ConsoleExportSnapshot } from "@/schemas/seo-console-export.schema";
import { consoleExportActions } from "./search-console-export-actions";

const url = "https://example.test/a";
const linked = (date: string, count: number): ConsoleExportSnapshot => ({
  kind: "linked_pages",
  date,
  reason: null,
  rows: [{ key: url, counts: { incomingLinks: count } }],
});
it("requires three overlapping dated counts for successive declines and does not add missing counts", () => {
  const first = linked("2026-01-01", 8),
    second = linked("2026-02-01", 4),
    third = linked("2026-03-01", 2);
  expect(
    consoleExportActions(third, second, first, new Set()).map((a) => a.title),
  ).toEqual([
    "Check which pages receive external links",
    "Review a target with two lower link counts",
  ]);
  expect(
    consoleExportActions(third, { ...second, rows: [] }, first, new Set()),
  ).toHaveLength(1);
});
it("suppresses indexing follow-up for a page with a passing later inspection", () => {
  const sample: ConsoleExportSnapshot = {
    kind: "indexing_examples",
    reason: "not_found",
    date: "2026-02-01",
    rows: [{ key: url, counts: {} }],
  };
  expect(consoleExportActions(sample, null, null, new Set([url]))).toEqual([]);
  expect(consoleExportActions(sample, null, null, new Set())[0]).toMatchObject({
    subject: url,
    nextCheck: expect.stringContaining("HTTP"),
  });
});
