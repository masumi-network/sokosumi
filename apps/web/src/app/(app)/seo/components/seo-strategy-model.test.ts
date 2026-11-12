import { describe, expect, it } from "vitest";
import {
  SEO_STRATEGY_VERDICTS,
  seoKeywordDemand,
  seoStrategyCounts,
  seoStrategyGroupOf,
  seoStrategyKey,
  seoStrategyPlaceHost,
  seoStrategyReason,
  seoStrategyTargetNotes,
} from "./seo-strategy-model";
import { seoTestStrategy } from "./seo-test-fixture";

const us = { countryCode: "US", languageCode: "en" };

describe("SEO strategy results", () => {
  it("shows the site a place's link opens, unless the name is that site", () => {
    const place = (name: string, url: string) =>
      seoStrategyPlaceHost({ name, url, form: "community" });
    expect(place("r/macapps", "https://www.reddit.com/r/macapps/")).toBe(
      "reddit.com",
    );
    expect(place("Forums.Example.com", "https://forums.example.com/")).toBe(
      null,
    );
    // The name holds the letters of the host, and the link opens another site.
    expect(place("reddit.com", "https://t.co/abc")).toBe("t.co");
  });

  it("splits the bot's reason into its result, one line per keyword and the groups left out", () => {
    expect(seoStrategyReason(seoTestStrategy())).toEqual({
      lead: "160 of 160 monthly searches of the keyword groups with a known reach lie in groups the site ranks for or can reach.",
      niche: null,
      details: [
        '"battery app" falls to 47 searches a month in the last 3 months, against a 12-month mean of 140',
        '"charge timer" rises to 60 searches a month in the last 3 months, against a 12-month mean of 20.',
        "1 of 4 keyword groups are left out: no search volume, or no referring-domains count to compare.",
      ],
    });
    // A full stop inside a number ends no sentence.
    expect(
      seoStrategyReason({ verdict: "keep", why: "Only 3.5 searches a month" }),
    ).toEqual({ lead: "Only 3.5 searches a month", niche: null, details: [] });
  });

  it("shows the niche sentence of a niche verdict, which the bot writes last", () => {
    const lead = "Only 10 of 160 monthly searches lie in groups in reach.";
    const niche =
      'The narrower niche "mac apps" has 90 monthly searches for "mac battery app", and the site can reach it.';
    const leftOut =
      "2 of 5 keyword groups are left out: no search volume, or no referring-domains count to compare (30 searches a month with no known reach).";
    expect(
      seoStrategyReason({
        verdict: "narrow",
        why: `${lead} "a; z" falls to 4 searches a month; "b" rises to 9 searches a month. ${leftOut} ${niche}`,
      }),
    ).toEqual({
      lead,
      niche,
      details: [
        // A keyword with "; " stays in one line.
        '"a; z" falls to 4 searches a month',
        '"b" rises to 9 searches a month.',
        leftOut,
      ],
    });
    // A niche name or keyword with a full stop stays whole.
    const market =
      'The near market "U.S. freelancers" has 90 monthly searches for "coconut vs. istat", and the site can reach it.';
    expect(
      seoStrategyReason({ verdict: "move", why: `${lead} ${market}` }),
    ).toEqual({ lead, niche: market, details: [] });
    const none =
      "None of the 4 niche candidates has 50 or more monthly searches in the site's reach.";
    expect(
      seoStrategyReason({ verdict: "no fit", why: `${lead} ${none}` }),
    ).toEqual({ lead, niche: none, details: [] });
    // A niche name that starts like another verdict's sentence does not move the split.
    const odd =
      'The narrower niche "None of the above tools" has 320 monthly searches for "x", and the site can reach it.';
    expect(
      seoStrategyReason({ verdict: "narrow", why: `${lead} ${odd}` }),
    ).toEqual({ lead, niche: odd, details: [] });
    // A last sentence in a form this does not know stays in the details.
    expect(
      seoStrategyReason({ verdict: "move", why: `${lead} Try video.` }),
    ).toEqual({ lead, niche: null, details: ["Try video."] });
    expect(
      seoStrategyReason({ verdict: "narrow", why: `${lead} ${niche}` }),
    ).toEqual({ lead, niche, details: [] });
    // The same text under another verdict has no niche sentence.
    expect(
      seoStrategyReason({ verdict: "keep", why: `${lead} ${niche}` }).niche,
    ).toBeNull();
  });

  it("finds a keyword's group by any of its forms, in the audit's Market only", () => {
    const strategy = seoTestStrategy();
    const groupOf = seoStrategyGroupOf(strategy);
    expect(groupOf({ keyword: "battery apps", ...us })?.lead).toBe(
      "battery app",
    );
    // Another keyword of the same search intent.
    expect(groupOf({ keyword: "battery health checker", ...us })?.lead).toBe(
      "battery app",
    );
    expect(groupOf({ keyword: "charge timer", ...us })?.reach).toBe("ranks");
    expect(groupOf({ keyword: "unknown", ...us })).toBeUndefined();
    expect(
      groupOf({
        keyword: "battery app",
        countryCode: "DE",
        languageCode: "en",
      }),
    ).toBeUndefined();
    expect(
      groupOf({
        keyword: "battery app",
        countryCode: "US",
        languageCode: "es",
      }),
    ).toBeUndefined();
    // An audit without a known Market cannot rule a row out.
    expect(
      seoStrategyGroupOf({
        ...strategy,
        countryCode: null,
        languageCode: null,
      })({ keyword: "battery app", countryCode: "DE", languageCode: "de" })
        ?.lead,
    ).toBe("battery app");
    // A form two groups share stays with the first group.
    strategy.groups[1].keywords.push("battery app");
    expect(
      seoStrategyGroupOf(strategy)({ keyword: "battery app", ...us })?.lead,
    ).toBe("battery app");
    expect(seoStrategyGroupOf(null)({ keyword: "x", ...us })).toBeUndefined();
  });

  it("says a keyword's reach and moving searches, and nothing a position already says", () => {
    const [falling, ranks, open] = seoTestStrategy().groups;
    expect(seoKeywordDemand(falling, " Battery  App")).toEqual({
      reach: "in reach",
      trend: { direction: "falling", recent: 47 },
    });
    // The searches are those of the group's biggest keyword. Another keyword of the group has its own.
    expect(seoKeywordDemand(falling, "battery health checker")).toEqual({
      reach: "in reach",
      trend: null,
    });
    // The group ranks and its searches are flat.
    expect(seoKeywordDemand(ranks, ranks.lead)).toBeNull();
    expect(seoKeywordDemand({ ...ranks, trend: "rising" }, ranks.lead)).toEqual(
      {
        reach: null,
        trend: { direction: "rising", recent: 47 },
      },
    );
    // A forum in the results is no row fact: the strategy line counts it.
    // A trend without its recent searches has no number to show.
    expect(
      seoKeywordDemand({ ...open, trend: "rising" }, open.lead),
    ).toBeNull();
    expect(seoKeywordDemand(undefined, "x")).toBeNull();
  });

  it("counts the keyword groups per reach, most first, and the ones that lose searches", () => {
    const { groups } = seoTestStrategy();
    expect(seoStrategyCounts([...groups, groups[2]])).toEqual({
      reaches: [
        { reach: "open", count: 2 },
        { reach: "in reach", count: 1 },
        { reach: "ranks", count: 1 },
      ],
      falling: 1,
    });
  });

  it("gives no message key to a word it does not know, also one that names an object member", () => {
    expect(seoStrategyKey(SEO_STRATEGY_VERDICTS, "out of reach")).toBe(
      "outOfReach",
    );
    expect(seoStrategyKey(SEO_STRATEGY_VERDICTS, "expand")).toBeNull();
    expect(seoStrategyKey(SEO_STRATEGY_VERDICTS, "constructor")).toBeNull();
    const [list, other] = seoTestStrategy().actions[0].targets;
    expect(seoStrategyTargetNotes(list)).toEqual({
      type: "list",
      state: "notMentioned",
    });
    expect(seoStrategyTargetNotes(other)).toEqual({ type: null, state: null });
  });
});
