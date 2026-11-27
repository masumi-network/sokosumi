import { describe, expect, it } from "vitest";
import { matchesText, mentionsAffirmed, plainQuotes } from "../check-text.js";

describe("check text", () => {
  it("matches a pattern written with ' against a reply typed with ’", () => {
    expect(plainQuotes("couldn’t “confirm”")).toBe(`couldn't "confirm"`);
    expect(matchesText("I couldn’t confirm the fee.", "couldn't confirm")).toBe(
      true,
    );
    expect(matchesText("I could confirm the fee.", "couldn't confirm")).toBe(
      false,
    );
  });

  it("does not count a mention that says the thing is left out", () => {
    for (const text of [
      "Report finished work and what waits on the owner, without the stuck/failed section.",
      "A square card, white background, no prices or plan numbers.",
      "Skip anything blocked.",
      "Do not include stuck items.",
    ])
      expect(mentionsAffirmed(text, "stuck|block|price"), text).toBe(false);
  });

  it("counts a mention the text affirms, also next to a negated one", () => {
    for (const text of [
      "Report finished, stuck and waiting work.",
      "No intro. List what is blocked.",
      "Not the summary: show the prices.",
      "Nothing is left out; the stuck part is kept.",
    ])
      expect(mentionsAffirmed(text, "stuck|block|price"), text).toBe(true);
  });
});
