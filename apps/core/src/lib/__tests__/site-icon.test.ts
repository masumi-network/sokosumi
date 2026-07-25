import { describe, expect, it } from "vitest";

import { parseIconCandidates, rankCandidates } from "@/lib/site-icon";

const BASE = "https://example.com/";

function urls(html: string): string[] {
  return rankCandidates(parseIconCandidates(html, BASE)).map((c) => c.url);
}

describe("parseIconCandidates", () => {
  it("resolves relative hrefs against the page URL", () => {
    expect(urls(`<link rel="icon" href="/favicon.png">`)).toEqual([
      "https://example.com/favicon.png",
    ]);
  });

  it("decodes HTML entities in hrefs", () => {
    // A raw `&amp;` reaches the CDN as a literal and 400s.
    expect(
      urls(`<link rel="apple-touch-icon" href="/i.png?w=180&amp;h=180">`),
    ).toEqual(["https://example.com/i.png?w=180&h=180"]);
  });

  it("accepts unquoted attribute values", () => {
    expect(urls(`<link rel=icon href=/favicon.ico>`)).toEqual([
      "https://example.com/favicon.ico",
    ]);
  });

  it("keeps attributes containing a bare > inside quotes", () => {
    expect(urls(`<link rel="icon" href="/logo>weird.png">`)).toEqual([
      "https://example.com/logo%3Eweird.png",
    ]);
  });

  it("accepts single-quoted and multi-token rel values", () => {
    expect(urls(`<link rel='shortcut icon' href='/f.ico'>`)).toEqual([
      "https://example.com/f.ico",
    ]);
  });

  it("ignores mask-icon and fluid-icon, which are not logos", () => {
    const html = `
      <link rel="mask-icon" href="/mask.svg">
      <link rel="fluid-icon" href="/fluid.png">
      <link rel="icon" href="/real.png">
    `;
    expect(urls(html)).toEqual(["https://example.com/real.png"]);
  });

  it("falls back to og:image when no icon link is declared", () => {
    expect(urls(`<meta property="og:image" content="/og.png">`)).toEqual([
      "https://example.com/og.png",
    ]);
  });

  it("skips links with no href and unresolvable URLs", () => {
    expect(urls(`<link rel="icon"><link rel="icon" href="http://">`)).toEqual(
      [],
    );
  });
});

describe("rankCandidates", () => {
  it("prefers an unsized apple-touch-icon over a tiny declared favicon", () => {
    const html = `
      <link rel="icon" sizes="16x16" href="/small.png">
      <link rel="apple-touch-icon" href="/apple.png">
    `;
    expect(urls(html)[0]).toBe("https://example.com/apple.png");
  });

  it("prefers the largest apple-touch-icon among several", () => {
    const html = `
      <link rel="apple-touch-icon" sizes="120x120" href="/a120.png">
      <link rel="apple-touch-icon" sizes="180x180" href="/a180.png">
    `;
    expect(urls(html)[0]).toBe("https://example.com/a180.png");
  });

  it("treats sizes=any as scalable and ranks it above fixed rasters", () => {
    const html = `
      <link rel="icon" sizes="32x32" href="/32.png">
      <link rel="icon" sizes="any" href="/vector.svg">
    `;
    expect(urls(html)[0]).toBe("https://example.com/vector.svg");
  });

  it("ranks declared icons above the og:image fallback", () => {
    const html = `
      <meta property="og:image" content="/og.png">
      <link rel="icon" sizes="32x32" href="/32.png">
    `;
    expect(urls(html)).toEqual([
      "https://example.com/32.png",
      "https://example.com/og.png",
    ]);
  });

  it("de-duplicates repeated URLs", () => {
    const html = `
      <link rel="icon" href="/same.png">
      <link rel="icon" href="/same.png">
    `;
    expect(urls(html)).toEqual(["https://example.com/same.png"]);
  });
});
