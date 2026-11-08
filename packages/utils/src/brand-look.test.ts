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
      colors: ["#5850ec", "#252f3f"],
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

  it("states no tone rather than guess one", () => {
    expect(designMdBrandLook("The voice is a mix of styles.").tone).toBeNull();
    expect(designMdBrandLook("# Brand").tone).toBeNull();
  });
});
