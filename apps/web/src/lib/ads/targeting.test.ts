import { describe, expect, it } from "vitest";

import { matchGoogleLanguage } from "./targeting";

const language = (code: string) => ({ id: `id-${code}`, code, name: code });

describe("matchGoogleLanguage", () => {
  it("finds a language by its code", () => {
    const german = language("de");

    expect(matchGoogleLanguage("de", [language("en"), german])).toBe(german);
  });

  it.each([
    ["DE", "de"],
    ["zh-CN", "zh_CN"],
    ["zh_tw", "zh-TW"],
    ["he", "iw"],
    ["iw", "he"],
    ["nb", "no"],
    ["no", "nb"],
    ["fil", "tl"],
    ["tl", "fil"],
  ])("matches %s with Google's %s", (market, google) => {
    const match = language(google);

    expect(matchGoogleLanguage(market, [language("en"), match])).toBe(match);
  });

  it("does not match a different language or a bare prefix", () => {
    expect(matchGoogleLanguage("zh-cn", [language("zh_TW")])).toBeUndefined();
    expect(matchGoogleLanguage("pt", [language("pt-BR")])).toBeUndefined();
    expect(matchGoogleLanguage("ja", [])).toBeUndefined();
  });
});
