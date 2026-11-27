import { describe, expect, it } from "vitest";
import { evalWebFetch, evalWebSearch } from "../eval-web-world";
import { CMO_PATH_DEV_BRANDS } from "./brands";
import { cmoPathSiteResponse } from "./sites";

describe("the fictional brands' sites", () => {
  it("are all under the reserved .example TLD", () => {
    for (const brand of CMO_PATH_DEV_BRANDS) {
      expect(brand.domain).toMatch(/\.example$/);
      expect(new URL(brand.eval.url).hostname).toBe(brand.domain);
    }
  });

  it("serve their pages and logo, 404 an unknown path, and leave every other address alone", async () => {
    const home = cmoPathSiteResponse("https://www.tallyform.example/");
    expect(home?.status).toBe(200);
    expect(home?.headers.get("content-type")).toContain("text/html");
    expect(await home?.text()).toContain("--brand:#1f4fd8");
    expect(
      cmoPathSiteResponse("https://tallyform.example/logo.svg")?.headers.get(
        "content-type",
      ),
    ).toContain("image/svg+xml");
    expect(cmoPathSiteResponse("https://tallyform.example/nope")?.status).toBe(
      404,
    );
    expect(cmoPathSiteResponse("https://unknown-brand.example/")).toBeNull();
    expect(cmoPathSiteResponse("https://cal.com/pricing")).toBeNull();
  });

  it("are what web_fetch and web_search find in an eval lane", () => {
    const pricing = evalWebFetch({ url: "https://tallyform.example/pricing/" });
    expect(pricing.status).toBe(200);
    expect(pricing.text).toContain("€29 per user per month");
    expect(pricing.text).not.toContain("<li>");
    expect(
      evalWebSearch("Crumb Kettle cardamom bun Leeds", 3).map((r) => r.url),
    ).toContain("https://crumbandkettle.example/menu");
  });
});
