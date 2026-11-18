import { expect, it } from "vitest";
import { seoSearchUrlPrefixCovers } from "./seo-traffic.js";

it("requires every page to match the registered origin and path", () => {
  const property = "https://EXAMPLE.com:443/help/";
  const article = "https://example.com/help/article";
  expect(seoSearchUrlPrefixCovers(property, [article])).toBe(true);
  expect(
    seoSearchUrlPrefixCovers("https://example.com/", [
      "https://EXAMPLE.com:443",
    ]),
  ).toBe(true);
  for (const other of [
    "https://example.com.au/help/article",
    "https://example.com/helpful",
    "invalid",
  ]) {
    expect(seoSearchUrlPrefixCovers(property, [article, other])).toBe(false);
  }
});
