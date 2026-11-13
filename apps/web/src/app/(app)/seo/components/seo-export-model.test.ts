import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../../messages/en.json";
import { seoTopPagesExport } from "./seo-export-model";
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
