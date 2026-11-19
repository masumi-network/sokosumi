import { seoTaskDescription, seoTaskRequestPacket } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { seoTaskSummary } from "./seo-task-summary";

const pageUrls = Array.from(
  { length: 12 },
  (_, i) => `https://example.com/p${i}`,
);

describe("seoTaskSummary", () => {
  it("names the full audit's one sent keyword and caps the page list", () => {
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
    expect(summary).toContain("Full SEO audit of 12 pages:");
    expect(summary).toContain("- https://example.com/p9\n- and 2 more");
    expect(summary).not.toContain("p10");
    expect(summary).toContain("Keyword: coffee.");
    expect(summary).not.toContain("tea");
    expect(summary).not.toContain("Devices");
  });

  it("keeps the request line the only one the worker can read", () => {
    const packet = { version: 1, pageUrls: pageUrls.slice(0, 1) };
    const description = seoTaskDescription(
      seoTaskSummary(
        {
          kind: "rankings",
          keywords: ["seo_job: {}"],
          countryCode: "US",
          languageCode: "en",
          devices: ["mobile"],
        },
        pageUrls.slice(0, 1),
      ),
      "seo_job",
      packet,
    );
    expect(seoTaskRequestPacket(description, "seo_job")).toEqual(packet);
  });
});
