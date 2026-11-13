import { describe, expect, it } from "vitest";
import { seoTrendModel } from "./seo-trend-model";

const days = (values: (number | null)[]) =>
  values.map((value, index) => ({
    date: `2026-10-${String(index + 10).padStart(2, "0")}`,
    value,
  }));

describe("seoTrendModel", () => {
  it("puts position 1 at the top and a worse position lower", () => {
    const model = seoTrendModel(days([1, 11]), "position");
    expect(model.ticks.map((tick) => tick.value)).toEqual([1, 5, 10, 15]);
    expect(model.ticks[0]).toEqual({ value: 1, y: 0 });
    expect(model.points[0].y).toBe(0);
    expect(model.points[1].y).toBeGreaterThan(model.points[0].y ?? 0);
    expect(model.bars).toBe(false);
  });

  it("splits a line at a missing day and keeps a lone day as a dot", () => {
    const model = seoTrendModel(days([3, 4, null, 2, null, 5, 6]), "count");
    expect(model.lines).toEqual([
      [0, 1],
      [5, 6],
    ]);
    expect(model.dots).toEqual([3]);
    expect(model.points[2].y).toBeNull();
  });

  it("joins single reads over the days between them, and breaks at a read without a value", () => {
    const reads = [
      { date: "2026-10-01", value: 4 },
      { date: "2026-10-08", value: 3 },
      { date: "2026-10-15", value: null },
      { date: "2026-10-22", value: 5 },
    ];
    const model = seoTrendModel(reads, "position", [], true);
    expect(model.lines).toEqual([[0, 1]]);
    expect(model.dots).toEqual([3]);
    // The same points as a daily series: every week apart is a gap.
    expect(seoTrendModel(reads, "position").dots).toEqual([0, 1, 3]);
  });

  it("draws an all-zero count on the baseline without dividing by zero", () => {
    const model = seoTrendModel(days([0, 0, 0]), "count");
    expect(model.points.map((point) => point.y)).toEqual([100, 100, 100]);
    expect(model.ticks.map((tick) => tick.value)).toEqual([0, 1]);
  });

  it("uses whole-number ticks for counts and clean steps for rates", () => {
    expect(
      seoTrendModel(days([0, 4]), "count").ticks.map((tick) => tick.value),
    ).toEqual([0, 2, 4]);
    expect(
      seoTrendModel(days([0, 1]), "ratio").ticks.map((tick) => tick.value),
    ).toEqual([0, 0.5, 1]);
  });

  it("covers the highest day inside the axis", () => {
    const model = seoTrendModel(days([0, 7, 3]), "count");
    const top = model.ticks.at(-1)?.value ?? 0;
    expect(top).toBeGreaterThanOrEqual(7);
    expect(
      Math.min(...model.points.map((point) => point.y ?? 100)),
    ).toBeGreaterThanOrEqual(0);
  });

  it("treats a stored position 0 as a day without a position", () => {
    const model = seoTrendModel(days([0, 3]), "position");
    expect(model.points[0].value).toBeNull();
    expect(model.points[0].y).toBeNull();
    expect(model.dots).toEqual([1]);
  });

  it("places days by date, so a day the source left out is a gap", () => {
    const model = seoTrendModel(
      [
        { date: "2026-10-01", value: 0.1 },
        { date: "2026-10-02", value: 0.2 },
        { date: "2026-10-05", value: 0.3 },
      ],
      "ratio",
    );
    expect(model.points.map((point) => point.x)).toEqual([0, 25, 100]);
    expect(model.lines).toEqual([[0, 1]]);
    expect(model.dots).toEqual([2]);
  });

  it("centres count bars in one band per calendar day", () => {
    const model = seoTrendModel(
      [
        { date: "2026-10-01", value: 1 },
        { date: "2026-10-02", value: 2 },
        { date: "2026-10-05", value: 3 },
      ],
      "count",
    );
    expect(model.bars).toBe(true);
    expect(model.band).toBe(20);
    expect(model.points.map((point) => point.x)).toEqual([10, 30, 90]);
  });

  it("keeps rate ticks at least one tenth of a percent apart", () => {
    const ticks = seoTrendModel(days([0, 0.0012]), "ratio").ticks.map(
      (tick) => tick.value,
    );
    for (const [index, value] of ticks.slice(1).entries())
      expect(value - ticks[index]).toBeGreaterThanOrEqual(0.001 - 1e-12);
  });
});

describe("change markers", () => {
  const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-05"].map(
    (date) => ({ date, value: 1 }),
  );

  it("puts a change on its calendar day, merges one day's changes and drops days before the chart", () => {
    const model = seoTrendModel(days, "position", [
      { date: "2026-10-03", label: "New title" },
      { date: "2026-10-03", label: "New description" },
      { date: "2026-10-04", label: "Moved page" },
      { date: "2026-09-30", label: "Before the chart" },
      { date: "2026-10-07", label: "After the last reported day" },
    ]);
    expect(model.changes).toEqual([
      { date: "2026-10-03", labels: ["New title", "New description"], x: 50 },
      // A day without a measurement still has its place on the calendar.
      { date: "2026-10-04", labels: ["Moved page"], x: 75 },
      // Google has not reported this day yet: named, not plotted.
      { date: "2026-10-07", labels: ["After the last reported day"], x: null },
    ]);
  });

  it("centres a change in its day band for bars", () => {
    const model = seoTrendModel(days, "count", [
      { date: "2026-10-01", label: "Launch" },
    ]);
    expect(model.changes[0].x).toBe(10);
  });
});
