import { describe, expect, it } from "vitest";
import {
  seoRunChecks,
  seoRunDays,
  seoRunsDateCheck,
  seoRunsNameSpan,
} from "./seo-runs-model";

const run = (observedAt: string, issues: number, kind = "audit_full") => ({
  observationId: observedAt,
  kind,
  observedAt: new Date(observedAt),
  issues,
  seconds: null,
});
const none = { from: null, to: null };

describe("SEO runs of a site", () => {
  it("marks a day scheduled when a monitor started one of its checks", () => {
    const { days } = seoRunDays(
      {
        runs: [
          { ...run("2026-11-12T09:00:00Z", 2), monitorId: "monitor-1" },
          run("2026-11-12T13:00:00Z", 1),
          { ...run("2026-11-11T09:00:00Z", 3), monitorId: null },
        ],
      },
      none,
    );
    expect(days.map(({ day, scheduled }) => ({ day, scheduled }))).toEqual([
      { day: "2026-11-12", scheduled: true },
      { day: "2026-11-11", scheduled: false },
    ]);
  });

  it("shows one entry per day, newest first, with the result of the newest check that tested rules", () => {
    const { days, picked } = seoRunDays(
      {
        runs: [
          run("2026-11-10T09:00:00Z", 6),
          // A keyword check tests no page rules: the audit of the same day gives the count.
          run("2026-11-12T18:00:00Z", 0, "rankings"),
          run("2026-11-12T13:00:00Z", 5),
          run("2026-11-11T08:00:00Z", 0, "links"),
        ],
      },
      none,
    );
    expect(
      days.map(({ day, issues, selected, newest }) => ({
        day,
        issues,
        selected,
        newest,
      })),
    ).toEqual([
      { day: "2026-11-12", issues: 5, selected: true, newest: true },
      { day: "2026-11-11", issues: null, selected: false, newest: false },
      { day: "2026-11-10", issues: 6, selected: false, newest: false },
    ]);
    expect(days[0].at).toEqual(new Date("2026-11-12T18:00:00Z"));
    expect(picked).toBe(false);
  });

  it("takes the count of a day from its newest rule check, also where that check read only some pages", () => {
    const partial = {
      ...run("2026-11-12T15:00:00Z", 0, "page_check"),
      issues: null,
    };
    const { days } = seoRunDays(
      { runs: [partial, run("2026-11-12T10:00:00Z", 5)] },
      none,
    );
    // The full check of the morning says less about the page of that day than the later check of one page.
    expect(days.map((entry) => entry.issues)).toEqual([null]);
  });

  it("marks the run that an end date shows, and no run for a range of days", () => {
    const runs = [
      run("2026-11-12T13:00:00Z", 5),
      run("2026-11-10T09:00:00Z", 6),
    ];
    const marked = (filters: { from: string | null; to: string | null }) => {
      const view = seoRunDays({ runs }, filters);
      return [view.days.find((entry) => entry.selected)?.day, view.picked];
    };
    // The day of an older run is the pick of that run.
    expect(marked({ from: null, to: "2026-11-10" })).toEqual([
      "2026-11-10",
      true,
    ]);
    // A day between two runs shows the older one, but it is a date the reader set.
    expect(marked({ from: null, to: "2026-11-11" })).toEqual([
      "2026-11-10",
      false,
    ]);
    // The day of the newest run shows the newest run: no pick of an older one.
    expect(marked({ from: null, to: "2026-11-12" })).toEqual([
      "2026-11-12",
      false,
    ]);
    expect(marked({ from: null, to: "2026-11-09" })).toEqual([
      undefined,
      false,
    ]);
    expect(marked({ from: "2026-11-01", to: "2026-11-10" })).toEqual([
      undefined,
      false,
    ]);
    // A range marks the days inside it instead.
    const inRange = (filters: { from: string | null; to: string | null }) =>
      seoRunDays({ runs }, filters)
        .days.filter((entry) => entry.inRange)
        .map((entry) => entry.day);
    expect(inRange({ from: "2026-11-01", to: "2026-11-10" })).toEqual([
      "2026-11-10",
    ]);
    expect(inRange({ from: "2026-11-11", to: null })).toEqual(["2026-11-12"]);
    expect(inRange({ from: null, to: "2026-11-12" })).toEqual([]);
  });

  it("keeps the five newest days, and an older day only while it is in view", () => {
    const runs = [3, 4, 5, 6, 7, 8, 9].map((day) =>
      run(`2026-11-0${day}T09:00:00Z`, day),
    );
    const shown = (to: string | null) =>
      seoRunDays({ runs }, { from: null, to }).days.map((entry) => entry.day);
    expect(shown(null)).toEqual([
      "2026-11-09",
      "2026-11-08",
      "2026-11-07",
      "2026-11-06",
      "2026-11-05",
    ]);
    expect(shown("2026-11-03")).toEqual([
      "2026-11-09",
      "2026-11-08",
      "2026-11-07",
      "2026-11-06",
      "2026-11-05",
      "2026-11-03",
    ]);
  });
  it("opens the newest rule check of each shown day, and none while the row shows no choice", () => {
    expect(
      seoRunChecks({
        runs: [
          run("2026-11-12T18:00:00Z", 0, "rankings"),
          run("2026-11-12T13:00:00Z", 5),
          run("2026-11-12T09:00:00Z", 7),
          run("2026-11-11T08:00:00Z", 0, "links"),
        ],
      }),
    ).toEqual(new Set(["2026-11-12T13:00:00Z"]));
    expect(seoRunChecks({ runs: [run("2026-11-12T13:00:00Z", 5)] })).toEqual(
      new Set(),
    );
  });
  it("names the date of a check only where the run in view is that check", () => {
    const runs = [
      run("2026-11-12T18:00:00Z", 0, "rankings"),
      run("2026-11-11T18:00:00Z", 0, "rankings"),
      run("2026-11-06T13:00:00Z", 5),
    ];
    // Daily keyword reads fill the row; the rule check behind the verdict is a day the row may not show.
    expect(seoRunsDateCheck({ runs }, none, "2026-11-06T13:00:00Z")).toBe(
      false,
    );
    const checked = [run("2026-11-12T13:00:00Z", 5), ...runs.slice(1)];
    expect(
      seoRunsDateCheck({ runs: checked }, none, "2026-11-12T13:00:00Z"),
    ).toBe(true);
    // A range with a start marks no day.
    expect(
      seoRunsDateCheck(
        { runs: checked },
        { from: "2026-11-01", to: null },
        "2026-11-12T13:00:00Z",
      ),
    ).toBe(false);
    // An end on a day without a check is a range up to it: the row names no check, so the date stays.
    expect(
      seoRunsDateCheck(
        {
          runs: [
            run("2026-11-12T13:00:00Z", 5),
            run("2026-11-10T13:00:00Z", 6),
          ],
        },
        { from: null, to: "2026-11-11" },
        "2026-11-10T13:00:00Z",
      ),
    ).toBe(false);
  });

  it("names the days of the position checks only where they span the row up to the day in view", () => {
    const runs = [
      run("2026-11-12T13:00:00Z", 5),
      run("2026-11-11T13:00:00Z", 5),
      run("2026-11-10T13:00:00Z", 6),
    ];
    const name = (
      oldest: string | null,
      newest: string | null,
      filters: { from: string | null; to: string | null } = none,
    ) => seoRunsNameSpan({ runs }, filters, oldest, newest);
    // Every day of the row up to the newest: the row says them.
    expect(name("2026-11-10T20:00:00Z", "2026-11-12T08:00:00Z")).toBe(2);
    // A span that starts later, or ends before the day in view, keeps its dates.
    expect(name("2026-11-11T20:00:00Z", "2026-11-12T08:00:00Z")).toBe(0);
    expect(name("2026-11-10T20:00:00Z", "2026-11-11T08:00:00Z")).toBe(0);
    // The oldest day picked: one day.
    expect(
      name("2026-11-10T20:00:00Z", "2026-11-10T21:00:00Z", {
        from: null,
        to: "2026-11-10",
      }),
    ).toBe(1);
    // UTC days, as on the row: 23:30 UTC is still the day of the row.
    expect(name("2026-11-10T23:30:00Z", "2026-11-12T23:30:00Z")).toBe(2);
    // A range, an end on a day without a check, and an unknown time name no day.
    expect(
      name("2026-11-10T20:00:00Z", "2026-11-12T08:00:00Z", {
        from: "2026-11-10",
        to: null,
      }),
    ).toBe(0);
    expect(
      seoRunsNameSpan(
        {
          runs: [
            run("2026-11-12T13:00:00Z", 5),
            run("2026-11-10T13:00:00Z", 6),
          ],
        },
        { from: null, to: "2026-11-11" },
        "2026-11-10T20:00:00Z",
        "2026-11-10T21:00:00Z",
      ),
    ).toBe(0);
    expect(name(null, "2026-11-12T08:00:00Z")).toBe(0);
    // An end on the newest day is a range the row shows as such: no one day in view.
    expect(
      name("2026-11-10T20:00:00Z", "2026-11-12T08:00:00Z", {
        from: null,
        to: "2026-11-12",
      }),
    ).toBe(0);
    // One day on the row is no row.
    expect(
      seoRunsNameSpan(
        { runs: [run("2026-11-12T13:00:00Z", 5)] },
        none,
        "2026-11-12T08:00:00Z",
        "2026-11-12T09:00:00Z",
      ),
    ).toBe(0);
  });

  it("leaves out a day whose check read only some of the pages", () => {
    const partial = { ...run("2026-11-11T08:00:00Z", 0), issues: null };
    expect(
      seoRunChecks({ runs: [run("2026-11-12T13:00:00Z", 5), partial] }),
    ).toEqual(new Set(["2026-11-12T13:00:00Z"]));
  });
});
