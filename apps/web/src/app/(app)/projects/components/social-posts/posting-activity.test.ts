import { describe, expect, it } from "vitest";
import {
  type ActivityDay,
  activityLevel,
  calendarWeeks,
  fillActivityRange,
  postingStreaks,
} from "./posting-activity";

const days: ActivityDay[] = [
  { date: "2026-10-01", posts: 1, engagement: 4 },
  { date: "2026-10-02", posts: 2, engagement: null },
  { date: "2026-10-04", posts: 1, engagement: 0 },
];

describe("posting consistency", () => {
  it("fills missing days and treats them as no posts", () => {
    expect(fillActivityRange(days).map((day) => day.date)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(fillActivityRange(days)[2]).toEqual({
      date: "2026-10-03",
      posts: 0,
      engagement: null,
    });
  });

  it("counts the current streak from the latest day and the longest run", () => {
    expect(postingStreaks(days)).toEqual({ current: 1, longest: 2 });
    expect(
      postingStreaks([
        { date: "2026-10-01", posts: 1, engagement: 1 },
        { date: "2026-10-02", posts: 1, engagement: 1 },
      ]),
    ).toEqual({ current: 2, longest: 2 });
  });

  it("returns empty streaks and weeks when there is no daily data", () => {
    expect(postingStreaks([])).toEqual({ current: 0, longest: 0 });
    expect(calendarWeeks([])).toEqual([]);
  });

  it("pads the first week to Sunday", () => {
    const weeks = calendarWeeks([
      { date: "2026-10-01", posts: 1, engagement: 1 },
    ]);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]?.slice(0, 4)).toEqual([null, null, null, null]);
    expect(weeks[0]?.[4]?.date).toBe("2026-10-01");
  });

  it("keeps unavailable engagement distinct from a measured zero", () => {
    const filled = fillActivityRange(days);
    const max = 4;
    expect(activityLevel(filled[1]!, "engagement", max)).toBeNull();
    expect(activityLevel(filled[3]!, "engagement", max)).toBe(0);
    expect(activityLevel(filled[0]!, "engagement", max)).toBe(4);
  });
});
