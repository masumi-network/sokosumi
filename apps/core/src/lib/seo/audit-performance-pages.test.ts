import { describe, expect, it } from "vitest";
import type { SeoIndexedPage } from "@/schemas/project-seo.schema";
import { auditPerformancePage } from "./audit-performance-pages";

const seed = "https://example.test/products";
const canonical = "https://www.example.test/products";
const inspection: SeoIndexedPage = {
  pageUrl: seed,
  verdict: "NEUTRAL",
  coverageState: "Page with redirect",
  googleCanonical: canonical,
  userCanonical: canonical,
  robotsTxtState: null,
  lastCrawlTime: null,
};
describe("canonical audit performance scope", () => {
  it.each([
    ["prefix does not cover www", "https://example.test/", inspection],
    [
      "wrong inspected seed",
      "sc-domain:example.test",
      { ...inspection, pageUrl: canonical },
    ],
    [
      "another path",
      "sc-domain:example.test",
      {
        ...inspection,
        userCanonical: canonical + "/private",
        googleCanonical: canonical + "/private",
      },
    ],
    [
      "a third subdomain",
      "sc-domain:example.test",
      {
        ...inspection,
        userCanonical: "https://app.example.test/products",
        googleCanonical: "https://app.example.test/products",
      },
    ],
    [
      "Google and owner disagree",
      "sc-domain:example.test",
      { ...inspection, userCanonical: seed },
    ],
    ["URL inspection failed", "sc-domain:example.test", undefined],
  ] as const)(
    "keeps the exact selected URL when %s",
    (_reason, property, answer) => {
      expect(auditPerformancePage(property, seed, answer)).toEqual({
        pageUrl: seed,
        measuredUrl: seed,
        basis: "unverified",
      });
    },
  );
});
