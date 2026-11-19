import { describe, expect, it } from "vitest";

import { type StyleCheckVerdict, styleCheckPasses } from "./style-check";

const clean: StyleCheckVerdict = {
  text: ["Review before you pay"],
  headlineCorrect: true,
  legible: true,
  copiedFromReference: false,
  brandColours: true,
  extraMarks: false,
  cornerClear: true,
  garbled: false,
  screenFaithful: true,
  problems: [],
};

describe("styleCheckPasses", () => {
  it("passes a clean picture and turns down each failure", () => {
    expect(styleCheckPasses(clean)).toBe(true);
    expect(styleCheckPasses({ ...clean, headlineCorrect: false })).toBe(false);
    expect(styleCheckPasses({ ...clean, extraMarks: true })).toBe(false);
  });

  it("turns down a picture that invents what the brand's own page shows", () => {
    expect(styleCheckPasses({ ...clean, screenFaithful: false })).toBe(false);
  });
});
