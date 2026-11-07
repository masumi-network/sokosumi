import { describe, expect, it } from "vitest";

import {
  SEO_OPPORTUNITY_LIMIT,
  SEO_OPPORTUNITY_RULES,
  searchOpportunities,
} from "./search-opportunities";

const source = (rows: Array<Record<string, number | string>>) => ({
  propertyId: "sc-domain:example.test",
  from: "2026-10-09",
  to: "2026-11-05",
  rows: rows.map((row) => ({
    query: "battery health",
    pageUrl: "https://www.example.test/",
    clicks: 0,
    impressions: 10,
    ctr: 0,
    averagePosition: 8,
    ...row,
  })) as Parameters<typeof searchOpportunities>[0]["rows"],
});

describe("search opportunities", () => {
  it("fires snippet review at the named bounds and not past them", () => {
    const rule = SEO_OPPORTUNITY_RULES.snippetReview;
    const [hit] = searchOpportunities(
      source([
        {
          averagePosition: rule.maxAveragePosition,
          impressions: rule.minImpressions,
          ctr: rule.maxCtr,
        },
      ]),
    );
    expect(hit.id).toMatch(/^gsc:snippet_review:/);
    expect(hit.kind).toBe("opportunity");
    expect(hit.why).toContain("not a confirmed problem");
    expect(
      searchOpportunities(
        source([
          {
            averagePosition: rule.maxAveragePosition,
            impressions: rule.minImpressions,
            ctr: rule.maxCtr + 0.001,
          },
        ]),
      )[0]?.id,
    ).not.toMatch(/^gsc:snippet_review:/);
  });

  it("fires striking distance only inside its average-position band", () => {
    const rule = SEO_OPPORTUNITY_RULES.strikingDistance;
    const ids = (averagePosition: number) =>
      searchOpportunities(source([{ averagePosition, ctr: 0.5 }])).map(
        (row) => row.id.split(":")[1],
      );
    expect(ids(rule.minAveragePosition)).toEqual(["striking_distance"]);
    expect(ids(rule.maxAveragePosition)).toEqual(["striking_distance"]);
    expect(ids(rule.maxAveragePosition + 0.1)).toEqual([]);
    expect(ids(rule.minAveragePosition - 0.1)).toEqual([]);
  });

  it("ignores rows below the impression floor", () => {
    expect(
      searchOpportunities(
        source([
          {
            impressions:
              SEO_OPPORTUNITY_RULES.strikingDistance.minImpressions - 1,
          },
        ]),
      ),
    ).toEqual([]);
  });

  it("gives stable IDs across syncs and caps the list", () => {
    const first = searchOpportunities(source([{}]))[0].id;
    expect(
      searchOpportunities({
        ...source([{}]),
        from: "2026-11-01",
        to: "2026-11-30",
      })[0].id,
    ).toBe(first);
    const many = source(
      Array.from({ length: SEO_OPPORTUNITY_LIMIT + 5 }, (_, i) => ({
        query: `q${i}`,
      })),
    );
    expect(searchOpportunities(many)).toHaveLength(SEO_OPPORTUNITY_LIMIT);
  });
});
