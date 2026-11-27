import { describe, expect, it } from "vitest";
import { seoBrandMatcher } from "./seo-brand.js";

describe("branded query split", () => {
  it("ignores case and accents on both sides", () => {
    expect(seoBrandMatcher(["acme"])("ACME shoes")).toBe(true);
    expect(seoBrandMatcher(["Café Müller"])("cafe muller opening hours")).toBe(
      true,
    );
    expect(seoBrandMatcher(["cafe muller"])("Café Müller")).toBe(true);
  });

  it("matches whole words in order, never part of a word", () => {
    expect(seoBrandMatcher(["art"])("party supplies")).toBe(false);
    expect(seoBrandMatcher(["acme"])("acmeshop login")).toBe(false);
    expect(seoBrandMatcher(["acme com"])("acme.com login")).toBe(true);
    expect(seoBrandMatcher(["acme shop"])("shop acme")).toBe(false);
    expect(seoBrandMatcher(["", "  "])("anything")).toBe(false);
  });

  it("matches terms in scripts without spaces as a substring", () => {
    expect(seoBrandMatcher(["ソニー"])("ソニーテレビ")).toBe(true);
    expect(seoBrandMatcher(["ซัมซุง"])("ซัมซุงทีวี")).toBe(true);
    expect(seoBrandMatcher(["삼성"])("삼성전자 서비스")).toBe(true);
    expect(seoBrandMatcher(["ソニー テレビ"])("パナソニック")).toBe(false);
  });

  it("reads a change of script in a query as a word bound", () => {
    expect(seoBrandMatcher(["iPhone"])("iPhoneケース")).toBe(true);
    expect(seoBrandMatcher(["LINE"])("LINEの使い方")).toBe(true);
    expect(seoBrandMatcher(["P50"])("华为P50价格")).toBe(true);
    expect(seoBrandMatcher(["acme"])("acme靴")).toBe(true);
    expect(seoBrandMatcher(["acme"])("acmeshop靴")).toBe(false);
    expect(seoBrandMatcher(["ソニー"])("ソニーテレビ")).toBe(true);
  });

  it("reads a Latin term with CJK punctuation as words, not as a substring", () => {
    expect(seoBrandMatcher(["Sony・Music"])("sony music japan")).toBe(true);
    expect(seoBrandMatcher(["paral·lel"])("paral.lel barcelona")).toBe(true);
    expect(seoBrandMatcher(["l·l"])("col·legi")).toBe(false);
  });

  it("keeps marks and letters that tell words apart", () => {
    expect(seoBrandMatcher(["हिंदी"])("हिंदू")).toBe(false);
    expect(seoBrandMatcher(["हिंदी"])("हिंदी फिल्म")).toBe(true);
    expect(seoBrandMatcher(["мои"])("мой магазин")).toBe(false);
    expect(seoBrandMatcher(["елка"])("ёлка купить")).toBe(true);
    expect(seoBrandMatcher(["αθηνα"])("Αθήνα")).toBe(true);
  });

  it("keeps the signs that make a name distinct", () => {
    expect(seoBrandMatcher(["C++"])("c programming")).toBe(false);
    expect(seoBrandMatcher(["C++"])("c++ tutorial")).toBe(true);
    expect(seoBrandMatcher(["C#"])("c# jobs")).toBe(true);
    expect(seoBrandMatcher(["AT&T"])("at&t login")).toBe(true);
    expect(seoBrandMatcher(["AT&T"])("at login")).toBe(false);
    expect(seoBrandMatcher(["acme"])("acme™ shoes")).toBe(true);
    expect(seoBrandMatcher(["acme co"])("acme & co")).toBe(true);
  });

  it("finds a plain term inside a query word joined by a sign", () => {
    expect(seoBrandMatcher(["johnson"])("johnson&johnson baby")).toBe(true);
    expect(seoBrandMatcher(["procter"])("procter&gamble jobs")).toBe(true);
    expect(seoBrandMatcher(["procter gamble"])("procter&gamble")).toBe(true);
    expect(seoBrandMatcher(["acme"])("acme&co")).toBe(true);
    expect(seoBrandMatcher(["acme"])("acme+ plan")).toBe(true);
    expect(seoBrandMatcher(["acme"])("acme#1 deal")).toBe(true);
    // A signed term still needs the whole signed word.
    expect(seoBrandMatcher(["AT&T"])("at t login")).toBe(false);
    expect(seoBrandMatcher(["C++"])("c programming")).toBe(false);
  });

  it("ignores Arabic and Hebrew vowel marks", () => {
    expect(seoBrandMatcher(["محمد"])("مُحَمَّد للتجارة")).toBe(true);
    expect(seoBrandMatcher(["مُحَمَّد"])("محمد للتجارة")).toBe(true);
    expect(seoBrandMatcher(["שלום"])("שָׁלוֹם בית")).toBe(true);
  });

  it("matches nothing with a term that has no letter or digit", () => {
    expect(seoBrandMatcher(["++"])("c++ ++ tips")).toBe(false);
    expect(seoBrandMatcher(["&&"])("&&")).toBe(false);
  });
});
