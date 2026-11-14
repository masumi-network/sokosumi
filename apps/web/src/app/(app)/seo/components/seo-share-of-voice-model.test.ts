import { describe, expect, it } from "vitest";
import { seoShareOfVoiceCard } from "./seo-share-of-voice-model";

const week = (
  weekStart: string,
  site: number,
  competitors: { domain: string; share: number }[],
  others = 0,
  unattributed = 0,
) => ({ weekStart, reads: 4, site, competitors, others, unattributed });

describe("seoShareOfVoiceCard", () => {
  it("shows the newest week: site first, competitors by share, then the rest", () => {
    const card = seoShareOfVoiceCard({
      ctrSource: "awr-2026-07",
      weeks: [
        week("2026-09-28", 0.1, [{ domain: "b.test", share: 0.3 }]),
        week(
          "2026-10-05",
          0.25,
          [
            { domain: "b.test", share: 0.2 },
            { domain: "a.test", share: 0.4 },
          ],
          0.15,
        ),
      ],
    });
    expect(card?.weekStart).toBe("2026-10-05");
    expect(card?.previousWeek).toBe("2026-09-28");
    expect(
      card?.rows.map((row) => [row.kind, row.domain, row.share, row.change]),
    ).toEqual([
      ["site", null, 0.25, 0.15],
      ["competitor", "a.test", 0.4, null],
      ["competitor", "b.test", 0.2, expect.closeTo(-0.1, 10)],
      ["others", null, 0.15, null],
    ]);
    expect(card?.siteWeeks.map((row) => row.weekStart)).toEqual([
      "2026-10-05",
      "2026-09-28",
    ]);
  });

  it("has no change in the first week, and names unattributed results only when they have a share", () => {
    const card = seoShareOfVoiceCard({
      ctrSource: "awr-2026-07",
      weeks: [week("2026-10-05", 0.5, [], 0, 0.5)],
    });
    expect(card?.rows.map((row) => [row.kind, row.change])).toEqual([
      ["site", null],
      ["unattributed", null],
    ]);
  });

  it("is null without SERP reads", () => {
    expect(seoShareOfVoiceCard(null)).toBeNull();
    expect(seoShareOfVoiceCard(undefined)).toBeNull();
    expect(seoShareOfVoiceCard({ ctrSource: "x", weeks: [] })).toBeNull();
  });
});
