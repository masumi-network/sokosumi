import { describe, expect, it } from "vitest";

import { siteLanguageOf, sitePlatformOf } from "./site-platform";

describe("sitePlatformOf", () => {
  it("knows a Shopify storefront by its CDN, theme or headers", () => {
    expect(
      sitePlatformOf(
        new Headers(),
        '<link href="//cdn.shopify.com/s/files/1/theme.css">',
      ),
    ).toBe("shopify");
    expect(
      sitePlatformOf(new Headers(), "<script>Shopify.theme = {}</script>"),
    ).toBe("shopify");
    expect(sitePlatformOf(new Headers({ "x-shopid": "123" }), "")).toBe(
      "shopify",
    );
  });

  it("calls every other site other", () => {
    expect(
      sitePlatformOf(
        new Headers(),
        "<html><body>We talk about Shopify apps</body></html>",
      ),
    ).toBe("other");
  });
});

describe("siteLanguageOf", () => {
  it("names the language the page declares, in English", () => {
    expect(siteLanguageOf('<html lang="de-CH" data-theme="normal">')).toBe(
      "German",
    );
    expect(siteLanguageOf("<html class='x' lang='fr'>")).toBe("French");
    expect(siteLanguageOf("<html><body>")).toBeNull();
  });
});
