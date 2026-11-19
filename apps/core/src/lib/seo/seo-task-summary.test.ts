import { describe, expect, it } from "vitest";

import { seoTaskSummary } from "./seo-task-summary";

const pageUrls = ["https://example.com/", "https://example.com/menu"];

describe("seoTaskSummary", () => {
  it("names only the full audit's one sent keyword", () => {
    const summary = seoTaskSummary(
      {
        kind: "audit_full",
        keywords: ["coffee", "tea"],
        countryCode: "DE",
        languageCode: "de",
        devices: ["mobile", "desktop"],
      },
      pageUrls,
    );
    expect(summary).toContain(
      "Full SEO audit of 2 selected pages:\n\n- https://example.com/\n- https://example.com/menu",
    );
    expect(summary).toContain("Target keyword: coffee.");
    expect(summary).not.toContain("tea");
    expect(summary).not.toContain("Devices");
  });
});
