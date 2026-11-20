import { describe, expect, it } from "vitest";

import {
  competitors,
  noCompetitors,
} from "../app/design-system/app/competitors-fixture";
import { seo } from "../app/design-system/app/fixtures";
import {
  cmoOverview,
  cmoStrategy,
  cmoStrategyVersion,
} from "../test-fixtures/cmo";
import { competitorsLead, dayName, pageLead, seoLead } from "./page-lead";

const NOW = new Date("2026-11-20T10:00:00Z");
const BERLIN = "Europe/Berlin";
const approved = cmoStrategyVersion(new Date("2026-11-02T09:00:00Z"));
const linkedin = {
  id: "c1",
  provider: "linkedin",
  handle: "acme",
  displayName: "Acme",
  status: "ACTIVE",
  personalProfile: false,
};
const entry = (
  id: string,
  channel: string,
  status: "draft" | "scheduled" | "published" | "idea",
) => ({
  id,
  date: "2026-11-21",
  channel,
  title: `Post ${id}`,
  format: "post",
  status,
  draft: "Words",
});
const month = (entries: ReturnType<typeof entry>[]) => ({
  ...approved,
  strategy: { ...cmoStrategy, calendar: entries },
});
const review = (nextRunAt: Date) => ({
  routines: [
    {
      key: "cmo-weekly-review",
      name: "Weekly review",
      when: "Mondays at 09:00",
      description: "",
      nextRunAt,
      timezone: BERLIN,
    },
  ],
});

describe("dayName", () => {
  it("says today and tomorrow on Cuso's clock, else the weekday", () => {
    expect(dayName("2026-11-20T18:00:00Z", BERLIN, NOW)).toBe("today");
    // 23:30 UTC on Friday is already Saturday in Berlin.
    expect(dayName("2026-11-20T23:30:00Z", BERLIN, NOW)).toBe("tomorrow");
    expect(dayName("2026-11-23T08:00:00Z", BERLIN, NOW)).toBe("Monday");
  });
});

describe("pageLead", () => {
  it("leaves Today to its greeting", () => {
    expect(pageLead("today", cmoOverview(), NOW)).toBeNull();
  });

  it("counts the posts that wait for a network on Channels", () => {
    const overview = cmoOverview({
      ...month([entry("a", "facebook", "draft"), entry("b", "x", "draft")]),
      channels: [linkedin],
    });
    expect(pageLead("channels", overview, NOW)).toMatchObject({
      kicker: "Channels",
      title: "2 posts wait for you.",
    });
  });

  it("says how many networks are connected once nothing waits", () => {
    const overview = cmoOverview({
      ...month([entry("a", "linkedin", "scheduled")]),
      channels: [linkedin],
    });
    expect(pageLead("channels", overview, NOW)?.title).toBe(
      "1 network connected.",
    );
    expect(
      pageLead("channels", cmoOverview({ channels: [], strategy: null }), NOW)
        ?.title,
    ).toBe("Connect a network.");
  });

  it("names the day the first numbers come on Results", () => {
    const overview = cmoOverview({
      ...month([entry("a", "linkedin", "scheduled")]),
      ...review(new Date("2026-11-23T08:00:00Z")),
      posts: { draft: 0, scheduled: 1, published: 0, failed: 0 },
    });
    expect(pageLead("results", overview, NOW)?.title).toBe(
      "Numbers start Monday.",
    );
  });

  it("counts what is out once a weekly report read it", () => {
    const overview = cmoOverview({
      ...month([entry("a", "linkedin", "published")]),
      ...review(new Date("2026-11-23T08:00:00Z")),
      posts: { draft: 0, scheduled: 0, published: 1, failed: 0 },
      updates: [
        {
          id: "u1",
          kind: "weekly",
          headline: "Week one",
          at: new Date("2026-11-16T08:00:00Z"),
          revertible: false,
          revertedAt: null,
          posts: [],
          media: [],
        },
      ],
    });
    expect(pageLead("results", overview, NOW)?.title).toBe(
      "1 post out so far.",
    );
  });

  it("counts the month's posts on the Calendar, ads left out", () => {
    const overview = cmoOverview({
      ...month([
        entry("a", "linkedin", "scheduled"),
        entry("b", "x", "draft"),
        { ...entry("c", "google_ads", "draft"), format: "search_ad" },
      ]),
    });
    expect(pageLead("calendar", overview, NOW)).toEqual({
      kicker: "Calendar · November",
      title: "2 posts this month.",
    });
  });

  it("dates the approval on Strategy and leaves its goal the headline", () => {
    expect(pageLead("strategy", cmoOverview(approved), NOW)).toEqual({
      kicker: "Strategy · approved 2 Nov",
    });
    expect(pageLead("strategy", cmoOverview(), NOW)?.kicker).toBe(
      "Strategy · draft",
    );
  });
});

describe("seoLead", () => {
  it("counts the page changes to make", () => {
    const open = seo.pageChanges.filter((c) => c.status === "open").length;
    expect(seoLead(seo, BERLIN, NOW).title).toBe(
      `${open} ${open === 1 ? "change" : "changes"} to make.`,
    );
    expect(seoLead(seo, BERLIN, NOW).kicker).toMatch(
      /^SEO · audit of acme\.io, /,
    );
  });

  it("says nothing is to change, and when the first audit runs", () => {
    const done = { ...seo, pageChanges: [] };
    expect(seoLead(done, BERLIN, NOW).title).toBe("Nothing to change.");
    const fresh = {
      ...done,
      audit: { ...seo.audit, latest: null },
    };
    expect(seoLead(fresh, BERLIN, NOW)).toMatchObject({
      kicker: "SEO",
      title: "First audit Monday.",
    });
  });
});

describe("competitorsLead", () => {
  it("leads with the big moves", () => {
    const big = competitors.feed?.items.filter((item) => item.big).length ?? 0;
    expect(competitorsLead(competitors).title).toBe(
      big === 1 ? "One big move this week." : `${big} big moves this week.`,
    );
  });

  it("calls a week without a move quiet, and an empty list empty", () => {
    const feed = competitors.feed;
    if (!feed) throw new Error("fixture has no feed");
    expect(
      competitorsLead({ ...competitors, feed: { ...feed, items: [] } }).title,
    ).toBe("A quiet week.");
    expect(
      competitorsLead({
        ...competitors,
        feed: {
          ...feed,
          items: feed.items.map((item) => ({ ...item, big: false })),
        },
      }).title,
    ).toMatch(/^(One move|\d+ moves) this week\.$/);
    expect(competitorsLead({ ...noCompetitors, competitors: [] }).title).toBe(
      "Nobody watched yet.",
    );
  });
});
