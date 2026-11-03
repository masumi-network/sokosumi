import { describe, expect, it } from "vitest";

import { sitePlatformOf } from "./site-platform";

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
