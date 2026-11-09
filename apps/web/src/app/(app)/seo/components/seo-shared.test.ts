import { describe, expect, it } from "vitest";
import { seoMarketName } from "./seo-shared";

describe("seoMarketName", () => {
  it("names a market in the reader's language", () => {
    expect(seoMarketName("en", "us", "en")).toBe("United States · English");
    expect(seoMarketName("de", "DE", "de")).toBe("Deutschland · Deutsch");
  });

  it("keeps a code Intl does not accept as saved", () => {
    expect(seoMarketName("en", "USA", null)).toBe("USA");
    expect(seoMarketName("en", "", "en")).toBe("English");
  });
});
