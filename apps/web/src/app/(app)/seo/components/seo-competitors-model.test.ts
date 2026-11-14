import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { competitorSites, seoHost } from "./seo-competitors-model";

type Competitor = ProjectSeoWorkspace["competitors"][number];

function row(
  url: string,
  rank: number | null,
  extra: Partial<Competitor> = {},
): Competitor {
  return {
    id: url,
    url,
    role: "competitor",
    confirmed: false,
    source: "search",
    rank,
    backlinks: null,
    referringDomains: null,
    observedAt: null,
    observationId: "check",
    version: 0,
    canConfirm: true,
    exclusionReason: null,
    ...extra,
  };
}

describe("competitorSites", () => {
  it("shows one row per site with its best placed page first", () => {
    const { sites } = competitorSites([
      row("https://unplaced.com/", null),
      row("https://other.com/", 2),
      row("https://www.rival.com/b", 4),
      row("https://second-unplaced.com/", null),
      row("https://rival.com/a", 1),
      row("https://rival.com/c", null),
    ]);
    // The best placed site leads; sites without a place follow in the order of the check.
    expect(sites.map((site) => site.host)).toEqual([
      "rival.com",
      "other.com",
      "unplaced.com",
      "second-unplaced.com",
    ]);
    expect(sites[0].pages.map((page) => page.url)).toEqual([
      "https://rival.com/a",
      "https://www.rival.com/b",
      "https://rival.com/c",
    ]);
    expect(sites[0].best).toBe(1);
  });

  it("leads with the page the reader chose, and keeps the best place of the site", () => {
    const { sites } = competitorSites([
      row("https://rival.com/a", 1),
      row("https://first.com/", 3),
      row("https://rival.com/b", 7, { confirmed: true }),
    ]);
    expect(sites.map((site) => site.host)).toEqual(["rival.com", "first.com"]);
    expect(sites[0].lead.url).toBe("https://rival.com/b");
    expect(sites[0].best).toBe(1);
  });

  it("puts platforms apart, but never a site the reader chose", () => {
    const found = competitorSites([
      row("https://www.youtube.com/watch?v=1", 1),
      row("https://en.wikipedia.org/wiki/Battery", 2),
      row("https://support.apple.com/en-us/1", 3),
      row("https://www.apple.com/mac/", 4),
      row("https://notyoutube.com/", 5),
      // A forum of any vendor is a platform; a site whose own name is "forum" is not.
      row("https://forums.macrumors.com/threads/1", 6),
      row("https://forum.com/", 7),
    ]);
    expect(found.platforms.map((site) => site.host)).toEqual([
      "youtube.com",
      "en.wikipedia.org",
      "support.apple.com",
      "forums.macrumors.com",
    ]);
    expect(found.sites.map((site) => site.host)).toEqual([
      "apple.com",
      "notyoutube.com",
      "forum.com",
    ]);
    // A page the reader added and then stopped tracking is still their choice.
    const chosen = competitorSites([
      row("https://www.youtube.com/@rival", 1, { confirmed: true }),
      row("https://www.reddit.com/r/rival", null, { source: "saved" }),
    ]);
    expect(chosen.platforms).toEqual([]);
    expect(chosen.sites).toHaveLength(2);
  });

  it("has no best place where no page has a rank", () => {
    expect(
      competitorSites([row("https://rival.com/", null)]).sites[0].best,
    ).toBeNull();
  });
});

describe("seoHost", () => {
  it("keeps a value that is no URL", () => {
    expect(seoHost("not a url")).toBe("not a url");
    expect(seoHost("https://www.Example.com/x")).toBe("example.com");
  });
});
