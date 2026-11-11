import { describe, expect, it } from "vitest";
import { seoMarketName, seoPagePath } from "./seo-shared";

describe("seoMarketName", () => {
  it("keeps a code Intl does not accept as saved", () => {
    expect(seoMarketName("en", "USA", null)).toBe("USA");
  });

  it("omits a missing country", () => {
    expect(seoMarketName("en", "", "en")).toBe("English");
  });
});

describe("seoPagePath", () => {
  const site = "https://example.com/";

  it("gives the address after the site, with its query", () => {
    expect(seoPagePath("https://example.com/guides/a?lang=de", site)).toBe(
      "/guides/a?lang=de",
    );
    expect(seoPagePath("https://example.com", site)).toBe("/");
  });

  it("keeps the whole address of a page on another host", () => {
    // A subdomain is another host: its path alone would name a page of the site.
    expect(seoPagePath("https://blog.example.com/a", site)).toBeNull();
    expect(seoPagePath("https://example.com:8443/a", site)).toBeNull();
  });

  it("keeps an address that does not parse", () => {
    expect(seoPagePath("/a", site)).toBeNull();
    expect(seoPagePath("https://example.com/a", "")).toBeNull();
  });
});
