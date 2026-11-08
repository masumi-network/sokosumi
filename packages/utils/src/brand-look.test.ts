import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  brandColors,
  brandFontName,
  brandFonts,
  designMdBrandLook,
  distinctColors,
  isNeutral,
  normalizeHex,
} from "./brand-look.js";

describe("brand look", () => {
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

  it("reads colours, fonts and tone from a generated DESIGN.md", () => {
    // Trimmed from the generator's output for plausible.io.
    const designMd = `---
name: Plausible Analytics
colors:
  surface: '#f9fafb'
  on-surface: '#252f3f'
  primary: '#5850ec'
  secondary: '#374151'
  tertiary: '#5f48ff'
typography:
  body-md:
    fontFamily: system-ui
---

## Overview

The voice is plain, factual and confident, favouring short declarative claims over hype.

## Colors

Primary #5850ec drives every call to action.
`;
    expect(designMdBrandLook(designMd)).toEqual({
      colors: ["#5850ec", "#374151"],
      fonts: [],
      tone: "plain, factual and confident",
    });
    expect(
      designMdBrandLook(
        "typography:\n  display:\n    fontFamily: Inter\nTone of voice is formal, impersonal and precise, written as a notice.",
      ),
    ).toEqual({
      colors: [],
      fonts: ["Inter"],
      tone: "formal, impersonal and precise",
    });
  });

  it("takes brand colours from the colour roles, not the error palette", () => {
    // Generator output for sokosumi.com, saved 2026-11-07. Its error roles
    // (#b3261e, #410e0b) used to read as brand colours.
    const designMd = readFileSync(
      new URL("./__fixtures__/design-md-sokosumi.md", import.meta.url),
      "utf8",
    );
    expect(brandColors(designMd, 5)).toContain("#b3261e");
    expect(designMdBrandLook(designMd)).toEqual({
      colors: ["#2b5c78", "#6400ff"],
      fonts: ["Inter"],
      tone: "plain, professional and colleague-like",
    });
  });

  it("keeps the declared roles when role lines end in CRLF", () => {
    // Without the roles, the repeated error red would lead the palette.
    const body =
      "  primary: '#6400ff'\r\n  error: '#b3261e'\r\n#b3261e #b3261e";
    expect(designMdBrandLook(`colors:\n${body}`).colors).toEqual(["#6400ff"]);
    expect(designMdBrandLook(`colors:\r\n${body}`).colors).toEqual(["#6400ff"]);
  });

  it("falls back to the most used colours without colour roles", () => {
    expect(
      designMdBrandLook("colors:\n  brand: '#6400ff'\n# Brand #6400ff").colors,
    ).toEqual(["#6400ff"]);
    expect(
      designMdBrandLook("colors:\n  primary: '#000000'\n  error: '#b3261e'")
        .colors,
    ).toEqual([]);
  });

  it("still weighs custom properties named like brand colours", () => {
    // One --*-accent-* declaration (weight 5) outranks three plain uses.
    const css =
      ":root{--color-accent-2: #ff6a00} a{color:#6400ff} b{color:#6400ff} i{color:#6400ff}";
    expect(brandColors(css)).toEqual(["#ff6a00", "#6400ff"]);
    expect(brandColors("x{--Brand:#ff6a00} a{color:#6400ff}")[0]).toBe(
      "#ff6a00",
    );
  });

  // CodeQL js/polynomial-redos: these took seconds before the fix.
  it.each([
    ["repeated --", "--".repeat(50_000)],
    ["--brand with repeated brand", `--${"brand".repeat(50_000)}`],
    ["indented colour block", `colors:\n${" ".repeat(100_000)}\u0000`],
  ])("reads %s in linear time", (_, input) => {
    const started = performance.now();
    designMdBrandLook(input);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("states no tone rather than guess one", () => {
    expect(designMdBrandLook("The voice is a mix of styles.").tone).toBeNull();
    expect(designMdBrandLook("# Brand").tone).toBeNull();
  });
});
