import { describe, expect, it } from "vitest";
import {
  type ActivityDay,
  activityLevel,
  activityTotals,
  calendarMonthStarts,
  contributionCalendar,
  fillActivityRange,
  postingStreaks,
  sparklineSeries,
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

  it("counts posts and active days on the publication series only", () => {
    expect(activityTotals(days)).toEqual({ posts: 4, active: 3 });
    expect(activityTotals([])).toEqual({ posts: 0, active: 0 });
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
    expect(contributionCalendar([])).toEqual([]);
  });

  it("frames a year of Sundays and counts only the publication range", () => {
    const weeks = contributionCalendar(days);
    expect(weeks).toHaveLength(53);
    for (const week of weeks) {
      expect(week).toHaveLength(7);
      expect(new Date(`${week[0]?.date}T00:00:00Z`).getUTCDay()).toBe(0);
    }
    const cells = weeks.flat();
    expect(cells.find((cell) => cell.date === "2026-10-01")).toMatchObject({
      inRange: true,
      posts: 1,
    });
    expect(cells.find((cell) => cell.date === "2026-10-03")).toMatchObject({
      inRange: true,
      posts: 0,
      engagement: null,
    });
    expect(cells.find((cell) => cell.date === "2026-09-30")?.inRange).toBe(
      false,
    );
    const counted = cells
      .filter((cell) => cell.inRange)
      .reduce((sum, cell) => sum + cell.posts, 0);
    expect(counted).toBe(activityTotals(days).posts);
    expect(counted).toBe(4);
    const months = calendarMonthStarts(weeks);
    expect(months.length).toBeGreaterThan(10);
    for (let index = 1; index < months.length; index += 1) {
      expect(
        (months[index] ?? 0) - (months[index - 1] ?? 0),
      ).toBeGreaterThanOrEqual(2);
    }
    expect(
      weeks[months.at(-1) ?? 0]?.some((cell) => cell.date === "2026-10-01"),
    ).toBe(true);
  });

  it("keeps unavailable engagement distinct from a measured zero", () => {
    const filled = fillActivityRange(days);
    const max = 4;
    expect(activityLevel(filled[1]!, "engagement", max)).toBeNull();
    expect(activityLevel(filled[3]!, "engagement", max)).toBe(0);
    expect(activityLevel(filled[0]!, "engagement", max)).toBe(4);
  });

  it("keeps a short sparkline daily and sums a long range by week", () => {
    const daily = [1, null, 3];
    expect(sparklineSeries(daily)).toBe(daily);
    const long = [
      1,
      null,
      2,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      4,
      null,
      5,
    ];
    expect(sparklineSeries(long)).toEqual([3, null, 9]);
  });
});
