import type { ProjectSeoMetric } from "@sokosumi/core-client";

const TICK_INTERVALS = 3;
const DAY_MS = 86_400_000;
/** Search positions start at 1; there is no position 0. */
const FIRST_POSITION = 1;
/** Rates show one percent decimal, so a finer step would repeat a tick label. */
const MIN_RATIO_STEP = 0.001;

type Point = ProjectSeoMetric["points"][number];

/** The smallest 1, 2 or 5 step (times a power of ten) that is at least `value`. */
function niceStep(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return (
    [1, 2, 5].map((factor) => factor * power).find((step) => step >= value) ??
    10 * power
  );
}

function dayNumber(date: string) {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

/**
 * Scale and shape of one daily metric for a single-axis line chart.
 * x and y are percentages of the plot; x follows the calendar, so a day the
 * source left out is a gap, never a zero. Position runs top-down (1 at the
 * top), because a lower position is better.
 */
export function seoTrendModel(points: Point[], unit: ProjectSeoMetric["unit"]) {
  const inverted = unit === "position";
  // Older saved syncs stored position 0 for days without impressions.
  const values = points.map((point) =>
    inverted && point.value !== null && point.value < FIRST_POSITION
      ? null
      : point.value,
  );
  const measured = values.filter((value): value is number => value !== null);
  const peak = Math.max(0, ...measured);
  const raw = niceStep(peak / TICK_INTERVALS);
  const step =
    unit === "ratio"
      ? Math.max(raw, MIN_RATIO_STEP)
      : unit === "count" || inverted
        ? Math.max(1, Math.ceil(raw))
        : raw;
  const lower = inverted ? FIRST_POSITION : 0;
  const upper = Math.max(step * Math.ceil(peak / step), lower + step);
  const y = (value: number) => {
    const share = (value - lower) / (upper - lower);
    return (inverted ? share : 1 - share) * 100;
  };
  const days = points.map((point) => dayNumber(point.date));
  const first = days[0] ?? 0;
  const span = (days.at(-1) ?? first) - first;
  const plotted = points.map((point, index) => ({
    date: point.date,
    value: values[index],
    x: span > 0 ? ((days[index] - first) / span) * 100 : 50,
    y: values[index] === null ? null : y(values[index] as number),
  }));
  const runs: number[][] = [];
  plotted.forEach((point, index) => {
    if (point.y === null) return;
    const run = runs.at(-1);
    const previous = run?.at(-1);
    if (run && previous === index - 1 && days[index] - days[previous] === 1)
      run.push(index);
    else runs.push([index]);
  });
  const ticks = [lower];
  for (let value = step; value <= upper + step / 2; value += step)
    if (value > lower) ticks.push(value);
  return {
    points: plotted,
    lines: runs.filter((run) => run.length > 1),
    dots: runs.filter((run) => run.length === 1).map(([index]) => index),
    ticks: ticks.map((value) => ({ value, y: y(value) })),
    // A wash under the line reads as volume; positions are not volume.
    area: !inverted,
    inverted,
  };
}

export type SeoTrendModel = ReturnType<typeof seoTrendModel>;
