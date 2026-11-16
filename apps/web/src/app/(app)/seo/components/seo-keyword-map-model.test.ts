import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { seoKeywordMap, seoNearestPoint } from "./seo-keyword-map-model";
import { keywordGroups } from "./seo-keyword-rows-model";

type Keyword = ProjectSeoWorkspace["keywords"][number];

let next = 0;
function row(patch: Partial<Keyword>): Keyword {
  next += 1;
  return {
    id: `k${next}`,
    keyword: `keyword ${next}`,
    pageUrl: "https://example.com/",
    targetPageId: null,
    saved: false,
    countryCode: "US",
    languageCode: "en",
    source: "focus",
    volume: null,
    difficulty: null,
    clicks: null,
    intent: null,
    conversion: null,
    feature: null,
    device: null,
    position: null,
    positionStatus: "unavailable",
    checkedResults: null,
    observedAt: null,
    observationId: null,
    priority: "medium",
    version: 0,
    ...patch,
  };
}
const ranked = (position: number) =>
  ({
    position,
    positionStatus: "ranked",
    observationId: "o1",
    observedAt: new Date("2026-11-01T00:00:00.000Z"),
  }) as const;
const clicks = (now: number) => ({ now, top10: 8, top3: 60, top1: 194 });

describe("SEO keyword map", () => {
  it("takes a keyword's click estimate from its best device", () => {
    const { checked } = keywordGroups([
      row({
        keyword: "battery",
        device: "mobile",
        ...ranked(12),
        clicks: clicks(7),
      }),
      row({
        keyword: "battery",
        device: "desktop",
        ...ranked(4),
        clicks: clicks(39),
      }),
    ]);
    expect(checked[0].clicks?.now).toBe(39);
  });

  it("claims no gain from a row of another rank than the best one", () => {
    // Read at place 2 without a volume; a ranked row at place 12 has one. The keyword is in the top 3 already.
    const { checked } = keywordGroups([
      row({ keyword: "battery", device: "mobile", ...ranked(2) }),
      row({
        keyword: "battery",
        source: "ranked",
        position: 12,
        positionStatus: "ranked",
        clicks: clicks(7),
      }),
    ]);
    expect(checked[0].best).toBe(2);
    expect(checked[0].clicks).toBeNull();
  });

  it("draws nothing with fewer than two keywords that have both numbers", () => {
    const groups = keywordGroups([
      row({ volume: 1000, difficulty: 30 }),
      row({ volume: 1000, difficulty: null }),
      row({ volume: null, difficulty: 30 }),
      row({ volume: 0, difficulty: 30 }),
    ]);
    expect(seoKeywordMap(groups)).toBeNull();
  });

  it("puts searches on a log scale, difficulty across, and keeps ideas apart from checked keywords", () => {
    const map = seoKeywordMap(
      keywordGroups([
        row({
          keyword: "big",
          volume: 10_000,
          difficulty: 80,
          ...ranked(15),
          clicks: clicks(7),
        }),
        row({
          keyword: "small idea",
          source: "gap",
          volume: 100,
          difficulty: 10,
        }),
      ]),
    );
    expect(map?.ticks.map((tick) => tick.value)).toEqual([100, 1000, 10_000]);
    // Between the decades, 2 and 5 times: the lines of a zoomed map, at their log place.
    expect(map?.minorTicks.map((tick) => tick.value)).toEqual([
      200, 500, 2000, 5000,
    ]);
    expect(map?.minorTicks[0]?.y).toBeCloseTo(100 - (Math.log10(2) / 2) * 100);
    expect(
      map?.points.map((point) => [
        point.group.lead.keyword,
        point.x,
        point.y,
        point.checked,
      ]),
    ).toEqual([
      ["small idea", 10, 100, false],
      ["big", 80, 0, true],
    ]);
  });

  it("gives equal volumes an axis", () => {
    const map = seoKeywordMap(
      keywordGroups([
        row({ volume: 500, difficulty: 20 }),
        row({ volume: 500, difficulty: 40 }),
      ]),
    );
    expect(map?.ticks.map((tick) => tick.value)).toEqual([100, 1000]);
    expect(map?.points.every((point) => Number.isFinite(point.y))).toBe(true);
  });

  it("grows a dot with the clicks place 3 adds, and keeps a keyword already there at the smallest size", () => {
    const map = seoKeywordMap(
      keywordGroups([
        row({
          keyword: "top",
          volume: 1000,
          difficulty: 20,
          ...ranked(2),
          clicks: { now: 96, top10: 8, top3: 60, top1: 194 },
        }),
        row({
          keyword: "far",
          volume: 1000,
          difficulty: 40,
          ...ranked(15),
          clicks: clicks(7),
        }),
      ]),
    );
    const [top, far] = map?.points ?? [];
    expect(top.gain).toEqual({ top10: 0, top3: 0 });
    expect(far.gain).toEqual({ top10: 1, top3: 53 });
  });

  it("finds the dot under the pointer and none away from every dot", () => {
    const map = seoKeywordMap(
      keywordGroups([
        row({ volume: 100, difficulty: 10 }),
        row({ volume: 10_000, difficulty: 90 }),
      ]),
    );
    const points = map?.points ?? [];
    const size = { width: 400, height: 200 };
    expect(seoNearestPoint(points, { x: 88, y: 2 }, size, 16)).toBe(1);
    expect(seoNearestPoint(points, { x: 50, y: 50 }, size, 16)).toBeNull();
  });
});
