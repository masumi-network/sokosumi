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

/** Share of a position plot kept under the scale for reads that found the page outside the checked results. */
const OUTSIDE_BAND = 0.15;

export type SeoTrendPoint = ProjectSeoMetric["points"][number] & {
  /** A position read that did not find the page in its `top` results: drawn under the scale, never as a value. */
  outside?: { top: number | null };
};

/** What happened on a marked day, strongest last: a confirmed fix outranks the work that led to it. */
export const SEO_MARKER_KINDS = [
  "audit",
  "change",
  "task",
  "verified",
] as const;
export type SeoMarkerKind = (typeof SEO_MARKER_KINDS)[number];
/** One event on the site that a chart marks on its day. */
export interface SeoChartMarker {
  date: string;
  kind: SeoMarkerKind;
  label: string;
}

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
 * The last day an update still rolling out on the as-of day can shade: the as-of day plus the longest
 * rollout of a finished update in the table. A stale table then cannot shade a chart without end.
 */
const OPEN_UPDATE_LAST_DAY =
  dayNumber(GOOGLE_EVENTS_AS_OF) +
  Math.max(
    0,
    ...GOOGLE_EVENTS.flatMap((event) =>
      (event.kind === "core update" || event.kind === "spam update") &&
      !event.open &&
      event.last
        ? [dayNumber(event.last) - dayNumber(event.first)]
        : [],
    ),
  );

/**
 * Scale and shape of one daily metric for a single-axis chart: bars for counts,
 * a line for rates and positions. x and y are percentages of the plot; x follows
 * the calendar, so a day the source left out is a gap, never a zero. Position runs top-down (1 at the
 * top), because a lower position is better.
 */
export function seoTrendModel(
  points: SeoTrendPoint[],
  unit: ProjectSeoMetric["unit"],
  /** Events on the site by day; a day outside the plotted span is left out. */
  markers: SeoChartMarker[] = [],
  /**
   * The points are single reads, not a daily series: a line joins neighbouring reads over the days
   * between them. A read without a value still breaks the line.
   */
  joinReads = false,
  /** Google updates and data anomalies; the ones outside the plotted days are left out. */
  events: readonly GoogleEvent[] = GOOGLE_EVENTS,
  /** First and last day of the x axis, so two charts side by side share it. Default: the points' own days. */
  domain?: { from: string; to: string },
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
  const outside = points.map(
    (point, index) =>
      (inverted && values[index] === null && point.outside) || null,
  );
  // The scale ends above the band, so a read outside the results never sits on a position.
  const scale = outside.some(Boolean) ? 1 - OUTSIDE_BAND : 1;
  const y = (value: number) => {
    const share = (value - lower) / (upper - lower);
    return (inverted ? share * scale : 1 - share) * 100;
  };
  const days = points.map((point) => dayNumber(point.date));
  const first = domain
    ? Math.min(days[0] ?? Infinity, dayNumber(domain.from))
    : (days[0] ?? 0);
  const span =
    Math.max(days.at(-1) ?? first, domain ? dayNumber(domain.to) : first) -
    first;
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
    y: outside[index]
      ? 100
      : values[index] === null
        ? null
        : y(values[index] as number),
    outside: outside[index],
  }));
  // Several events on one day share one marker, drawn as the strongest of them.
  const marked = new Map<
    number,
    { date: string; events: Omit<SeoChartMarker, "date">[] }
  >();
  for (const { date, ...event } of markers) {
    const day = dayNumber(date);
    // An event after the last reported day is still kept; it just has no place on the plot.
    if (!points.length || day < first) continue;
    const known = marked.get(day);
    if (known) known.events.push(event);
    else marked.set(day, { date, events: [event] });
  }
  const changes = [...marked]
    .sort(([a], [b]) => a - b)
    .map(([day, change]) => ({
      ...change,
      kind: change.events.reduce<SeoMarkerKind>(
        (strongest, { kind }) =>
          SEO_MARKER_KINDS.indexOf(kind) > SEO_MARKER_KINDS.indexOf(strongest)
            ? kind
            : strongest,
        change.events[0].kind,
      ),
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
        // An update still rolling out has no known end: its band runs on, at most to OPEN_UPDATE_LAST_DAY.
        const to = Math.min(
          event.open
            ? OPEN_UPDATE_LAST_DAY
            : dayNumber(event.last ?? event.first),
          last,
        );
        if (from > to) return [];
        const x = clip(edges(from)[0]);
        return [
          {
            name: event.name,
            first: event.first,
            last: event.last,
            // Still rolling out on the as-of day: last is that day, not the real end.
            open: event.open === true,
            x,
            width: clip(edges(to)[1]) - x,
          },
        ];
      })
    : [];
  const runs: number[][] = [];
  plotted.forEach((point, index) => {
    // A read outside the results has a mark of its own and breaks the line: no position joins it.
    if (point.y === null || point.outside) return;
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
            update.first <= date &&
            (update.open
              ? dayNumber(date) <= OPEN_UPDATE_LAST_DAY
              : (update.last ?? update.first) >= date),
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
    /** Where the band for reads outside the results starts, in percent of the plot; null without such a read. */
    outsideFrom: scale < 1 ? scale * 100 : null,
  };
}

export type SeoTrendModel = ReturnType<typeof seoTrendModel>;
