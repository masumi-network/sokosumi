import { describe, expect, it } from "vitest";
import { seoRankBand } from "./seo-rank-pill";

describe("seoRankBand", () => {
  it.each([
    [1, "top3"],
    [3, "top3"],
    [4, "page1"],
    [10, "page1"],
    [11, "rest"],
  ])("puts position %i in %s", (position, band) => {
    expect(seoRankBand(position)).toBe(band);
  });
});
