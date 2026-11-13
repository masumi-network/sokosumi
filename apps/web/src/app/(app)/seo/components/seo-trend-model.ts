import type { ProjectSeoMetric } from "@sokosumi/core-client";
import {
  GOOGLE_EVENTS,
  GOOGLE_EVENTS_AS_OF,
  type GoogleEvent,
} from "@sokosumi/utils";

const TICK_INTERVALS = 3;
const DAY_MS = 86_400_000;
/** Search positions start at 1; there is no position 0. */
const FIRST_POSITION = 1;
/** Rates show one percent decimal, so a finer step would repeat a tick label. */
const MIN_RATIO_STEP = 0.001;

type Point = ProjectSeoMetric["points"][number];

/**
 * The Google events that can move one chart's metric. A data anomaly is a Search Console reporting
 * fault, so a chart of another source (Analytics, the paid SERP checks) leaves it out; an event that did
 * not move clicks stays off a clicks chart and off Analytics visits. An event for pages with some markup is left out, because which plotted pages
 * carry that markup is not known.
 */
export function seoChartEvents(
  series: Pick<ProjectSeoMetric, "source" | "key">,
  events: readonly GoogleEvent[] = GOOGLE_EVENTS,
) {
  const analytics = series.source === "ga4";
  const searchConsole = series.source === "search_console";
  return events.filter(
    (event) =>
      !event.scope &&
      !(!searchConsole && event.kind === "data anomaly") &&
      !((analytics || series.key === "clicks") && !event.clicks),
  );
}

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
 * Scale and shape of one daily metric for a single-axis chart: bars for counts,
 * a line for rates and positions. x and y are percentages of the plot; x follows
 * the calendar, so a day the source left out is a gap, never a zero. Position runs top-down (1 at the
 * top), because a lower position is better.
 */
export function seoTrendModel(
  points: Point[],
  unit: ProjectSeoMetric["unit"],
  /** Recorded changes by day; a day outside the plotted span is left out. */
  markers: { date: string; label: string }[] = [],
  /**
   * The points are single reads, not a daily series: a line joins neighbouring reads over the days
   * between them. A read without a value still breaks the line.
   */
  joinReads = false,
  /** Google updates and data anomalies; the ones outside the plotted days are left out. */
  events: readonly GoogleEvent[] = GOOGLE_EVENTS,
) {
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
  // Counts are whole events per day, so they draw as bars in equal day bands.
  const bars = unit === "count";
  const band = 100 / (span + 1);
  const plotted = points.map((point, index) => ({
    date: point.date,
    value: values[index],
    x: bars
      ? (days[index] - first + 0.5) * band
      : span > 0
        ? ((days[index] - first) / span) * 100
        : 50,
    y: values[index] === null ? null : y(values[index] as number),
  }));
  // Several changes on one day share one marker.
  const marked = new Map<number, { date: string; labels: string[] }>();
  for (const marker of markers) {
    const day = dayNumber(marker.date);
    // A change after the last reported day is still named; it just has no place on the plot.
    if (!points.length || day < first) continue;
    const known = marked.get(day);
    if (known) known.labels.push(marker.label);
    else marked.set(day, { date: marker.date, labels: [marker.label] });
  }
  const changes = [...marked]
    .sort(([a], [b]) => a - b)
    .map(([day, change]) => ({
      ...change,
      x:
        day > first + span
          ? null
          : bars
            ? (day - first + 0.5) * band
            : span > 0
              ? ((day - first) / span) * 100
              : 50,
    }));
  // The left and right edge of one day on the plot: a day band for bars, half a day around the point for a line.
  const edges = (day: number): [number, number] =>
    bars
      ? [(day - first) * band, (day - first + 1) * band]
      : span > 0
        ? [
            ((day - first - 0.5) / span) * 100,
            ((day - first + 0.5) / span) * 100,
          ]
        : [0, 100];
  const clip = (x: number) => Math.min(Math.max(x, 0), 100);
  const last = first + span;
  // A lasting change (no last day) is a step on its first day.
  const updates = points.length
    ? events.flatMap((event) => {
        const from = Math.max(dayNumber(event.first), first);
        const to = Math.min(dayNumber(event.last ?? event.first), last);
        if (from > to) return [];
        const x = clip(edges(from)[0]);
        return [
          {
            name: event.name,
            first: event.first,
            last: event.last,
            x,
            width: clip(edges(to)[1]) - x,
          },
        ];
      })
    : [];
  const runs: number[][] = [];
  plotted.forEach((point, index) => {
    if (point.y === null) return;
    const run = runs.at(-1);
    const previous = run?.at(-1);
    if (
      run &&
      previous === index - 1 &&
      (joinReads || days[index] - days[previous] === 1)
    )
      run.push(index);
    else runs.push([index]);
  });
  const ticks = [lower];
  for (let value = step; value <= upper + step / 2; value += step)
    if (value > lower) ticks.push(value);
  return {
    points: plotted,
    changes,
    updates,
    /** The names of the updates that run on a plotted day. */
    updatesOn: (date: string) =>
      updates
        .filter(
          (update) =>
            update.first <= date && (update.last ?? update.first) >= date,
        )
        .map((update) => update.name),
    /**
     * The last day the table of updates covers, where the reader needs it: beside a band, or under a chart
     * that runs past that day and so can miss an update.
     */
    updatesAsOf:
      updates.length > 0 || (points.at(-1)?.date ?? "") > GOOGLE_EVENTS_AS_OF
        ? GOOGLE_EVENTS_AS_OF
        : null,
    lines: runs.filter((run) => run.length > 1),
    dots: runs.filter((run) => run.length === 1).map(([index]) => index),
    ticks: ticks.map((value) => ({ value, y: y(value) })),
    bars,
    band,
    inverted,
  };
}

export type SeoTrendModel = ReturnType<typeof seoTrendModel>;
