import { describe, expect, it } from "vitest";
import { importedSitemapHints, sitemapDraftXml } from "./seo-sitemap-model";

const seed = "https://book.test/";
const xmlns = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
const page = (location: string) => `<url><loc>${location}</loc></url>`;

describe("sitemap XML input and draft export", () => {
  it("imports distinct same-origin pages and ignores embedded image URLs", () => {
    const xml = `<urlset ${xmlns} xmlns:i="http://www.google.com/schemas/sitemap-image/1.1">
      <url><loc>${seed}amp&amp;more</loc><i:image><i:loc>${seed}img.png</i:loc></i:image></url>
      ${page(seed + "amp&amp;more")}${page("https://foreign.test/page")}${page(seed + "q?ref=one")}${page(seed + "profile/person")}${page(seed + "private%2fa")}${page(seed + "dl.exe")}</urlset>`;
    expect(importedSitemapHints(xml, seed)).toEqual([seed + "amp&more"]);
  });
  it("rejects entity declarations and sitemap indexes, and caps the reviewed URL list", () => {
    const xml = `<urlset ${xmlns}>${Array.from({ length: 25 }, (_, i) => page(seed + i)).join("")}</urlset>`;
    expect(importedSitemapHints(xml, seed)).toHaveLength(10);
    expect(() =>
      importedSitemapHints(`<!DOCTYPE xx []>${xml}`, seed),
    ).toThrow();
    expect(() =>
      importedSitemapHints(
        `<sitemapindex ${xmlns}>${page(seed + "custom.xml")}</sitemapindex>`,
        seed,
      ),
    ).toThrow();
  });
  it("downloads only eligible pages on a single origin in well-formed escaped XML", () => {
    const xml = sitemapDraftXml([
      { targetUrl: seed + "story&one", sitemapEligible: true },
      { targetUrl: seed + "duplicate" },
    ]);
    expect(xml).toContain("Partial audit sample");
    expect(xml).toContain("story&amp;one");
    expect(importedSitemapHints(xml!, seed)).toEqual([seed + "story&one"]);
    expect(sitemapDraftXml([{ targetUrl: seed }])).toBeNull();
    expect(
      sitemapDraftXml([
        { targetUrl: seed + "download.exe", sitemapEligible: true },
      ]),
    ).toBeNull();
    expect(
      sitemapDraftXml([
        { targetUrl: seed, sitemapEligible: true },
        { targetUrl: "https://other.test/", sitemapEligible: true },
      ]),
    ).toBeNull();
  });
});
