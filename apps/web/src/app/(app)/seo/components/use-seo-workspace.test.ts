import { describe, expect, it } from "vitest";
import { seoSameSelection } from "./use-seo-workspace";

const key = (query: string) => [
  "seo-workspace",
  "org",
  "user",
  "site",
  "s1",
  query,
];

describe("SEO workspace reads of one selection", () => {
  it("keeps a read in view only while the dates alone change", () => {
    expect(
      seoSameSelection(key("pageId=p1"), key("pageId=p1&to=2026-11-10")),
    ).toBe(true);
    expect(seoSameSelection(key("from=2026-11-01"), key("to=2026-11-10"))).toBe(
      true,
    );
    // Another page, channel or owner shows other data: an old page under a new pick could act on the wrong page.
    expect(seoSameSelection(key("pageId=p1"), key("pageId=p2"))).toBe(false);
    expect(seoSameSelection(key(""), key("channel=organic"))).toBe(false);
    expect(
      seoSameSelection(key(""), [
        "seo-workspace",
        "org",
        "user",
        "site",
        "s2",
        "",
      ]),
    ).toBe(false);
  });
});
