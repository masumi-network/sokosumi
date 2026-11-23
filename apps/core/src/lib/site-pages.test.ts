import { describe, expect, it } from "vitest";

import { parseRobots, pickSitePages, sitemapLocations } from "./site-pages";

describe("parseRobots", () => {
  it("allows everything when the file is empty", () => {
    expect(parseRobots("").allows("/pricing")).toBe(true);
  });

  it("follows the rules for every robot, the longest match deciding", () => {
    const robots = parseRobots(
      [
        "User-agent: *",
        "Disallow: /app/",
        "Disallow: /*.pdf$",
        "Allow: /app/public/",
        "# a comment",
        "Sitemap: https://acme.io/sitemap-pages.xml",
      ].join("\n"),
    );
    expect(robots.allows("/pricing")).toBe(true);
    expect(robots.allows("/app/settings")).toBe(false);
    expect(robots.allows("/app/public/tour")).toBe(true);
    expect(robots.allows("/files/deck.pdf")).toBe(false);
    expect(robots.allows("/files/deck.pdf.html")).toBe(true);
    expect(robots.sitemaps).toEqual(["https://acme.io/sitemap-pages.xml"]);
  });

  it("uses the group that names us instead of the one for everyone", () => {
    const robots = parseRobots(
      [
        "User-agent: *",
        "Disallow: /",
        "",
        "User-agent: Googlebot",
        "User-agent: SokosumiBot",
        "Disallow: /private",
      ].join("\n"),
    );
    expect(robots.allows("/")).toBe(true);
    expect(robots.allows("/private/x")).toBe(false);
  });

  it("stays out of a site that asks every robot to", () => {
    expect(parseRobots("User-agent: *\nDisallow: /").allows("/")).toBe(false);
  });
});

describe("sitemapLocations", () => {
  it("reads plain and CDATA addresses", () => {
    expect(
      sitemapLocations(
        "<urlset><url><loc>https://acme.io/pricing</loc></url>" +
          "<url><loc><![CDATA[https://acme.io/a?b=1&amp;c=2]]></loc></url></urlset>",
      ),
    ).toEqual(["https://acme.io/pricing", "https://acme.io/a?b=1&c=2"]);
  });
});

describe("pickSitePages", () => {
  it("keeps the site's own pages once, home first, without legal, sign-in, files or translations", () => {
    expect(
      pickSitePages("https://acme.io", [
        "https://www.acme.io/pricing/",
        "https://acme.io/pricing?ref=nav",
        "https://acme.io/#top",
        "https://other.io/pricing",
        "https://acme.io/privacy",
        "https://acme.io/legal/terms",
        "https://acme.io/sign-in",
        "https://acme.io/brochure.pdf",
        "https://acme.io/de/pricing",
        "https://acme.io/blog/tag/news",
        "https://acme.io/blog/launch",
        "https://acme.io/about",
        "mailto:hi@acme.io",
      ]),
    ).toEqual([
      "https://acme.io/",
      "https://acme.io/pricing",
      "https://acme.io/about",
      "https://acme.io/blog/launch",
    ]);
  });

  it("reads shallow pages first, a few below one path, and stops at the cap", () => {
    const posts = Array.from(
      { length: 20 },
      (_, index) => `https://acme.io/blog/post-${index}`,
    );
    const picked = pickSitePages(
      "https://acme.io",
      [...posts, "https://acme.io/pricing", "https://acme.io/blog"],
      { allows: (path) => path !== "/blog/post-3" },
      8,
    );
    expect(picked.slice(0, 3)).toEqual([
      "https://acme.io/",
      "https://acme.io/pricing",
      "https://acme.io/blog",
    ]);
    expect(picked).toHaveLength(8);
    expect(picked).not.toContain("https://acme.io/blog/post-3");
    expect(picked.filter((url) => url.includes("/blog/"))).toHaveLength(5);
  });
});
