import { describe, expect, it } from "vitest";
import { readSeoPageQuery, seoTab } from "./seo-query";

const PROJECT = "39d1c2a6-aade-4322-aed5-3f139a34b127";
const PAGE = "2c32dca9-c44f-4372-9114-8c146d5eb30b";
describe("SEO URL boundary", () => {
  it("keeps a valid page and date selection", () => {
    expect(
      readSeoPageQuery({
        projectId: PROJECT,
        pageId: PAGE,
        from: "2024-02-29",
        to: "2024-03-01",
        tab: "keywords",
      }).success,
    ).toBe(true);
  });
  it.each([
    { pageId: PAGE, scopeId: PROJECT },
    { pageIds: [PAGE, PROJECT] },
    { pageIds: PAGE },
    { from: "2025-02-29" },
    { from: "2025-04-31" },
    { from: "2025-03-02", to: "2025-03-01" },
    { pageId: [PAGE, PROJECT] },
    { projectId: "other-workspace" },
  ])("rejects invalid filters instead of widening scope: %j", (filters) => {
    expect(readSeoPageQuery(filters).success).toBe(false);
  });
});

describe("SEO tab in the URL", () => {
  it.each([
    ["overview", "agent"],
    ["keywords", "rankings"],
    ["competitors", "rankings"],
    ["pages", "health"],
    ["traffic", "traffic"],
    ["actions", "actions"],
  ])("opens %s links on the %s tab", (value, tab) => {
    expect(seoTab(value)).toBe(tab);
  });
  it.each(["constructor", "toString", "Overview", ""])(
    "refuses an unknown tab: %j",
    (value) => {
      expect(seoTab(value)).toBeNull();
      expect(readSeoPageQuery({ tab: value }).success).toBe(false);
    },
  );
});
