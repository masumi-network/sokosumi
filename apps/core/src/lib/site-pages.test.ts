import { describe, expect, it } from "vitest";

import { parseRobots, sitemapLocations } from "./site-pages";

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
