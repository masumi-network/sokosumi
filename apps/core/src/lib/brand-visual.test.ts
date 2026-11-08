import { describe, expect, it } from "vitest";

import { findImages, findLogo, siteNameFrom } from "./brand-visual";

describe("brand visual", () => {
  it("finds the logo image, else the touch icon", () => {
    const base = "https://acme.io/";
    expect(
      findLogo('<img class="site-logo" src="/img/logo.svg" alt="Acme">', base),
    ).toBe("https://acme.io/img/logo.svg");
    expect(
      findLogo('<link rel="apple-touch-icon" href="/icon-180.png">', base),
    ).toBe("https://acme.io/icon-180.png");
    expect(findLogo("<p>No images</p>", base)).toBeNull();
    expect(
      findLogo(
        '<img src="https://status.example.com/badge/v2" alt="Status logo"><img src="https://logos.cdn.com/globex-logo.svg" alt="Globex logo">',
        base,
      ),
    ).toBeNull();
  });

  it("names the business from the title part that matches the domain", () => {
    const base = "https://www.tartinebakery.com/";
    expect(
      siteNameFrom(
        "<title>About Us &#8211; Tartine Bakery</title>",
        "https://www.tartinebakery.com/pages/about",
      ),
    ).toBe("Tartine Bakery");
    expect(
      siteNameFrom(
        '<meta property="og:site_name" content="Ben &amp; Jerry&#39;s">',
        base,
      ),
    ).toBe("Ben & Jerry's");
    expect(
      siteNameFrom(
        "<title>Plausible Analytics | Simple, privacy-friendly analytics</title>",
        "https://plausible.io/",
      ),
    ).toBe("Plausible Analytics");
    expect(
      siteNameFrom(
        `<title>Tartine Bakery &#8211; ${"A long tagline. ".repeat(12)}</title>`,
        base,
      ),
    ).toBe("Tartine Bakery");
    expect(siteNameFrom("<title>Welcome</title>", base)).toBe("Welcome");
    expect(siteNameFrom("<p>No title</p>", base)).toBeNull();
  });

  it("finds photos and skips logos, icons and pixels", () => {
    const html = `
      <meta property="og:image" content="https://cdn.acme.io/share.jpg">
      <img src="/img/logo.png" alt="Acme">
      <img src="/img/bread.jpg" alt="Morning bun">
      <img src="/img/tiny.jpg" width="40">
      <img src="/img/arrow.svg">
      <img data-src="//cdn.acme.io/oven.webp" class="lazy">`;
    expect(findImages(html, "https://acme.io/")).toEqual([
      "https://cdn.acme.io/share.jpg",
      "https://acme.io/img/bread.jpg",
      "https://cdn.acme.io/oven.webp",
    ]);
  });
});
