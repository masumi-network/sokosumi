import { describe, expect, it } from "vitest";

import {
  brandColors,
  brandFontName,
  brandFonts,
  distinctColors,
  findImages,
  findLogo,
  isNeutral,
  normalizeHex,
  siteNameFrom,
} from "./brand-visual";

describe("brand visual", () => {
  it("keeps brand colours and drops neutrals", () => {
    const css = `
      :root { --brand-primary: #6400ff; --text: #111; }
      a { color: #6400FF } .btn { background: rgb(255, 106, 0) }
      body { background: #ffffff; color: #333333 }
    `;
    expect(brandColors(css)).toEqual(["#6400ff", "#ff6a00"]);
    expect(isNeutral("#f5f5f5")).toBe(true);
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
  });

  it("reads the fonts the site sets, not the fallbacks", () => {
    const css = `body { font-family: "Inter", system-ui, sans-serif }
      h1 { font-family: 'PP Mori', Inter } p { font-family: Inter }`;
    expect(brandFonts(css)).toEqual(["Inter", "PP Mori"]);
    expect(
      brandFonts("font-family:&quot;Inter Display&quot;, sans-serif"),
    ).toEqual(["Inter Display"]);
    expect(
      brandFonts("a{font-family:Inter} b{font-family:'Inter Fallback'}"),
    ).toEqual(["Inter"]);
  });

  it("names brand fonts and drops fallbacks and generic families", () => {
    expect(brandFontName("Inter Fallback")).toBeNull();
    expect(brandFontName("__Inter_Fallback_abc")).toBeNull();
    expect(brandFontName("__Inter_Fallback_d65c78")).toBeNull();
    expect(brandFontName("system-ui")).toBeNull();
    expect(brandFontName("__Inter_d65c78")).toBe("Inter");
    expect(brandFontName("'PP Mori'")).toBe("PP Mori");
    expect(
      brandFonts(
        "a{font-family:__Inter_d65c78, '__Inter_Fallback_d65c78'} b{font-family:'Inter Fallback'} c{font-family:system-ui}",
      ),
    ).toEqual(["Inter"]);
  });

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

  it("merges near-identical colours", () => {
    expect(
      distinctColors(["#1e2a5a", "#202c5e", "#6400ff", "#6a05ff", "#ff6a00"]),
    ).toEqual(["#1e2a5a", "#6400ff", "#ff6a00"]);
  });

  it("leaves code and icon fonts out", () => {
    expect(brandFontName("Menlo")).toBeNull();
    expect(brandFontName("FontAwesome")).toBeNull();
    expect(brandFontName("Font Awesome 6 Free")).toBeNull();
    expect(brandFontName("JetBrains Mono")).toBeNull();
    expect(brandFontName("PitchSans")).toBe("PitchSans");
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
