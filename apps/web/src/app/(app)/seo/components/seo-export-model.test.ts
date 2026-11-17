import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../../messages/en.json";
import {
  seoKeywordsExport,
  seoTablePlan,
  seoTopPagesExport,
} from "./seo-export-model";
import { keywordGroups } from "./seo-keyword-rows-model";
import { seoTestKeyword } from "./seo-test-fixture";
import { seoKeyEvents } from "./seo-traffic-model";

// The test translator has the same keys; only its value types are wider than the hook's.
const t = createTranslator({
  locale: "en",
  messages,
  namespace: "App.Seo",
}) as unknown as IntlTranslation<"App.Seo">;
const page = (pageUrl: string) => ({
  pageUrl,
  clicks: 4,
  impressions: 40,
  ctr: 0.1,
  averagePosition: 3,
  queries: 2,
  topQuery: "example",
});

describe("seoTopPagesExport", () => {
  it("adds the key events column with its own period when Google Analytics has a read", () => {
    const keyEvents = seoKeyEvents({
      channel: "organic",
      observationId: "0b6f6a3e-1c55-4b1a-9a43-1f3d2c4b5a69",
      propertyId: "properties/123",
      from: "2026-01-01",
      to: "2026-01-02",
      observedAt: new Date("2026-01-03T00:00:00Z"),
      rows: [
        { pageUrl: "https://example.com/shop", keyEvents: 3, sessions: 9 },
      ],
      skippedUrls: ["https://example.com/"],
    });
    const rows = [
      page("https://example.com/shop"),
      page("https://example.com/"),
      page("https://example.com/blog"),
    ];
    const table = seoTopPagesExport(rows, t, keyEvents);
    expect(table.header.at(-2)).toBe(
      "Key events (organic) 2026-01-01/2026-01-02",
    );
    expect(table.rows.map((row) => row.at(-2))).toEqual([
      3,
      "Not read: shares a landing path with another selected page",
      null,
    ]);
    expect(seoTopPagesExport(rows, t).header).not.toContain(
      "Key events (organic)",
    );
    expect(seoTopPagesExport(rows, t).header).toHaveLength(7);
  });
});

describe("seoTablePlan", () => {
  const source = {
    title: "Keywords · example.com · 2026-11-17",
    description: "Copied from SEO",
    projectId: null,
  };
  const exported = seoKeywordsExport(
    keywordGroups([
      seoTestKeyword({ volume: 1200 }),
      // Tracked by hand, never read: no volume, no position, no date.
      seoTestKeyword({
        id: "keyword-2",
        keyword: "charge timer",
        source: "saved",
        version: 1,
        position: null,
        positionStatus: "unavailable",
        observedAt: null,
        observationId: null,
        device: null,
      }),
    ]).checked,
    t,
  );

  it("types each column from its values and keeps a blank blank, never 0", () => {
    const plan = seoTablePlan(exported, source, "key-1");
    const type = (name: string) =>
      plan.table.columns.find((column) => column.name === name)?.type;
    expect(type("Keyword")).toBe("text");
    expect(type("Page")).toBe("url");
    expect(type("Searches a month")).toBe("number");
    expect(type("Position")).toBe("number");
    expect(type("Last checked")).toBe("date");
    const id = (name: string) =>
      plan.table.columns.find((column) => column.name === name)?.id ?? "";
    const rows = plan.batches.flatMap((batch) => batch.insert);
    // The list's order: the reader's own choice first.
    expect(rows.map((row) => row.values[id("Keyword")])).toEqual([
      "charge timer",
      "battery app",
    ]);
    const [tracked, read] = rows;
    expect(read.values[id("Searches a month")]).toBe(1200);
    expect(read.values[id("Last checked")]).toBe("2026-10-08");
    expect(id("Position") in tracked.values).toBe(false);
    expect(id("Searches a month") in tracked.values).toBe(false);
  });

  it("puts every row in batches of at most 100 under the same key, never cutting any", () => {
    const many = {
      header: ["Keyword"],
      rows: Array.from({ length: 250 }, (_, i) => [`keyword ${i}`]),
    };
    const plan = seoTablePlan(many, source, "key-2");
    expect(plan.table.key).toBe("key-2");
    expect(plan.table.rows).toEqual([]);
    expect(plan.batches.map((batch) => batch.insert.length)).toEqual([
      100, 100, 50,
    ]);
    expect(plan.batches.map((batch) => batch.key)).toEqual([
      "key-2:0",
      "key-2:100",
      "key-2:200",
    ]);
  });

  it("keeps a page that is not a web address as text", () => {
    const plan = seoTablePlan(
      { header: ["Page"], rows: [["https://example.com/"], ["/pricing"]] },
      source,
      "key-3",
    );
    expect(plan.table.columns[0].type).toBe("text");
  });
});
