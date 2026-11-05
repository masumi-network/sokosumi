import { describe, expect, it } from "vitest";

import { newsletterBrandFromDesignMd } from "./newsletter-brand-from-design-md";

describe("newsletterBrandFromDesignMd", () => {
  it("reads labeled colors and the font from front matter", () => {
    const markdown = `---
version: alpha
name: Acme
colors:
  primary: "#FF51FF"
  on-primary: "#0A0A0A"
  primary-hover: "#E040E0"
  accent: "#0055ff"
  on-accent: "#FFFFFF"
  background: "#FAFAFA"
  error: "#B00020"
typography:
  display:
    fontFamily: Georgia
    fontSize: 30px
  body:
    fontFamily: Inter
components:
  button:
    backgroundColor: "#123456"
---

# Acme
`;
    expect(newsletterBrandFromDesignMd(markdown)).toEqual({
      primaryColor: "#ff51ff",
      accentColor: "#0055ff",
      backgroundColor: "#fafafa",
      buttonTextColor: "#ffffff",
      fontFamily: "Georgia",
    });
  });

  it("reads the front matter the site fallback writes", () => {
    const markdown = `---
name: "Tartine"
colors:
  brand-1: "#aa3300"
  brand-2: "#0066aa"
typography:
  font-1:
    fontFamily: "Playfair Display"
---

Logo: https://cdn.example.com/tartine.png
`;
    expect(newsletterBrandFromDesignMd(markdown)).toEqual({
      primaryColor: "#aa3300",
      accentColor: "#0066aa",
      fontFamily: "Georgia",
      logoUrl: "https://cdn.example.com/tartine.png",
    });
  });

  it("reads loose markdown with hex colors, a font and a logo", () => {
    const markdown = `# Brand

We lean warm. See [our site](https://example.com/page#abc) and issue &#123;.

- **Primary color:** \`#F60\`
- **Accent (sky):** #0af
- **Body font:** "Helvetica Neue", Arial, sans-serif

![Acme logo](https://cdn.example.com/brand/a.svg)
`;
    expect(newsletterBrandFromDesignMd(markdown)).toEqual({
      primaryColor: "#ff6600",
      accentColor: "#00aaff",
      fontFamily: "Helvetica",
      logoUrl: "https://cdn.example.com/brand/a.svg",
    });
  });

  it("reads every labeled color on one line and table rows", () => {
    expect(
      newsletterBrandFromDesignMd("Colors: primary #cc0000, accent #0000cc"),
    ).toEqual({ primaryColor: "#cc0000", accentColor: "#0000cc" });
    expect(
      newsletterBrandFromDesignMd(
        "| Primary | #cc0000 | CTAs |\n| #0000cc | Accent | Links |",
      ),
    ).toEqual({ primaryColor: "#cc0000", accentColor: "#0000cc" });
  });

  it("returns nothing for empty text or a document without tokens", () => {
    expect(newsletterBrandFromDesignMd("")).toEqual({});
    expect(
      newsletterBrandFromDesignMd("# Voice\n\nWarm, plain and short."),
    ).toEqual({});
  });

  it("ignores neutrals unless the DESIGN.md labels one", () => {
    expect(
      newsletterBrandFromDesignMd(
        "White #ffffff\nInk #111111\nGrey #888888\nStone #d6d3d1",
      ),
    ).toEqual({});
    expect(
      newsletterBrandFromDesignMd(
        "White #ffffff\nHero #cc0000\nInk #111111\nLink #0000cc",
      ),
    ).toEqual({ primaryColor: "#cc0000", accentColor: "#0000cc" });
    expect(newsletterBrandFromDesignMd("primary: #000000")).toEqual({
      primaryColor: "#000000",
    });
  });

  it("skips near repeats and state colors when guessing", () => {
    expect(
      newsletterBrandFromDesignMd(
        "Navy #001f5b\nNavy 2 #002266\nerror: #cc0000\nGold #e0a100",
      ),
    ).toEqual({ primaryColor: "#001f5b", accentColor: "#e0a100" });
  });

  it("does not read a long sentence as a label or a shade as the role", () => {
    expect(
      newsletterBrandFromDesignMd(
        "The primary color should never appear beside an old shade like #cc0000",
      ),
    ).toEqual({ primaryColor: "#cc0000" });
    expect(
      newsletterBrandFromDesignMd("primary-light: #ffcccc\nprimary: #cc0000"),
    ).toEqual({ primaryColor: "#cc0000", accentColor: "#ffcccc" });
    expect(
      newsletterBrandFromDesignMd("card background: #ffeeee").backgroundColor,
    ).toBeUndefined();
  });

  it.each([
    ["fontFamily: Inter", "Arial"],
    ["font-family: 'Trebuchet MS', sans-serif;", "Trebuchet MS"],
    ["Typeface: Times", "Times New Roman"],
    ["Font family: Noto Serif", "Georgia"],
    ["| Font | Open Sans |", "Arial"],
    ["--font-sans: Acme Grotesk, Verdana;", "Verdana"],
  ])("maps %s onto an allowed font", (markdown, fontFamily) => {
    expect(newsletterBrandFromDesignMd(markdown)).toEqual({ fontFamily });
  });

  it.each([
    "fontFamily: Acme Grotesk",
    "fontFamily: Roboto Mono",
    "fontSize: 16px",
    "fontFamily: {typography.body}",
  ])("leaves the font unset for %s", (markdown) => {
    expect(newsletterBrandFromDesignMd(markdown)).toEqual({});
  });

  it.each([
    ["Logo: https://cdn.example.com/a.png.", "https://cdn.example.com/a.png"],
    [
      'logoUrl: "https://cdn.example.com/a.png"',
      "https://cdn.example.com/a.png",
    ],
    ["Primary logo: https://cdn.example.com/a", "https://cdn.example.com/a"],
    [
      "| Logo | https://cdn.example.com/a.png |",
      "https://cdn.example.com/a.png",
    ],
    [
      "![](https://cdn.example.com/logo.png)",
      "https://cdn.example.com/logo.png",
    ],
  ])("finds the logo in %s", (markdown, logoUrl) => {
    expect(newsletterBrandFromDesignMd(markdown)).toEqual({ logoUrl });
  });

  it("does not take a link beside the word logo or an http URL", () => {
    expect(
      newsletterBrandFromDesignMd(
        "Never distort the logo, see https://brand.example.com/guidelines",
      ),
    ).toEqual({});
    expect(
      newsletterBrandFromDesignMd("Logo: http://cdn.example.com/a.png"),
    ).toEqual({});
  });

  it("prefers the markdown's logo over the owner's, and skips an unusable one", () => {
    const logoUrl = "https://cdn.example.com/owner.png";
    expect(newsletterBrandFromDesignMd("", { logoUrl })).toEqual({ logoUrl });
    expect(
      newsletterBrandFromDesignMd("Logo: https://cdn.example.com/doc.png", {
        logoUrl,
      }),
    ).toEqual({ logoUrl: "https://cdn.example.com/doc.png" });
    expect(
      newsletterBrandFromDesignMd("", { logoUrl: "http://example.com/a.png" }),
    ).toEqual({});
    expect(newsletterBrandFromDesignMd("", { logoUrl: null })).toEqual({});
  });
});
