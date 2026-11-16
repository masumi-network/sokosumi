import { describe, expect, it } from "vitest";
import {
  seoFoldCount,
  seoMarketName,
  seoPageName,
  seoPagePath,
} from "./seo-shared";

describe("seoFoldCount", () => {
  it("folds a list only when the fold hides more than one row", () => {
    expect(seoFoldCount(10)).toBe(10);
    // "Show 1 more" takes the room of the row it hides.
    expect(seoFoldCount(11)).toBe(11);
    expect(seoFoldCount(12)).toBe(10);
    expect(seoFoldCount(4, 3)).toBe(4);
    expect(seoFoldCount(5, 3)).toBe(3);
  });
});

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

describe("seoPageName", () => {
  it("names the home page, gives a path for the site and the address for any other page", () => {
    const site = "https://example.com/";
    expect(seoPageName("https://example.com/", site, "Home page")).toBe(
      "Home page",
    );
    expect(seoPageName("https://example.com/a", site, "Home page")).toBe("/a");
    expect(seoPageName("https://other.example/", site, "Home page")).toBe(
      "https://other.example/",
    );
    // No site is known: no address can be cut.
    expect(seoPageName("https://example.com/", null, "Home page")).toBe(
      "https://example.com/",
    );
  });
});
