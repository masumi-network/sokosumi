import { describe, expect, it } from "vitest";
import { seoMarketName } from "./seo-shared";

describe("seoMarketName", () => {
  it("keeps a code Intl does not accept as saved", () => {
    expect(seoMarketName("en", "USA", null)).toBe("USA");
  });

  it("omits a missing country", () => {
    expect(seoMarketName("en", "", "en")).toBe("English");
  });
});
