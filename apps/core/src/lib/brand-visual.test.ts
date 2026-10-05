import { describe, expect, it } from "vitest";

import {
  brandColors,
  brandFonts,
  findLogo,
  isNeutral,
  normalizeHex,
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
});
