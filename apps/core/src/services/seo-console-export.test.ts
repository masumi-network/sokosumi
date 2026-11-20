import { expect, it } from "vitest";
import type { ConsoleExportSnapshot } from "@/schemas/seo-console-export.schema";
import { summarizeConsoleExport } from "./seo-console-export";

const current: ConsoleExportSnapshot = {
  kind: "linked_pages",
  reason: null,
  date: "2026-01-02",
  rows: [
    { key: "https://example.test/a", counts: { incomingLinks: 1 } },
    { key: "https://example.test/b", counts: { incomingLinks: 3 } },
  ],
};
const audited = new Set(["https://example.test/a"]);
it("compares overlapping rows without turning a missing page into a zero count", () => {
  const previous: ConsoleExportSnapshot = {
    ...current,
    date: "2026-01-01",
    rows: [
      { key: "https://example.test/a", counts: { incomingLinks: 9 } },
      { key: "https://example.test/other", counts: { incomingLinks: 4 } },
    ],
  };
  expect(summarizeConsoleExport(current, previous, audited)).toMatchObject({
    previousDate: "2026-01-01",
    sampleSize: 2,
    newInSample: 1,
    absentFromSample: 1,
    entries: [
      {
        key: "https://example.test/a",
        auditedUrl: true,
        previousCounts: { incomingLinks: 9 },
      },
      {
        key: "https://example.test/b",
        auditedUrl: false,
        previousCounts: null,
      },
    ],
  });
});

it("does not compare reports of another type, indexing reason, or the same date", () => {
  for (const previous of [
    { ...current, kind: "internal_pages", date: "2026-01-01" } as const,
    current,
  ]) {
    expect(
      summarizeConsoleExport(current, previous, audited).previousDate,
    ).toBeNull();
  }
  expect(
    summarizeConsoleExport(
      { ...current, kind: "indexing_examples", reason: "not_found" },
      {
        ...current,
        kind: "indexing_examples",
        reason: "excluded_noindex",
        date: "2026-01-01",
      },
      audited,
    ).previousDate,
  ).toBeNull();
});
