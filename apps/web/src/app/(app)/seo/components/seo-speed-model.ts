import type { ProjectSeoSiteSpeed } from "@sokosumi/core-client";

export type SeoSiteSpeedRow = ProjectSeoSiteSpeed["rows"][number];
/** One device's measurements of a page. A row of an audit's pageSpeed has the same shape. */
export type SeoSpeedDevice = SeoSiteSpeedRow["devices"][number];

export const SEO_VITALS = ["lcp", "inp", "cls"] as const;
export type SeoVital = (typeof SEO_VITALS)[number];
export type SeoSpeedMetric = SeoVital | "fcp" | "tbt" | "si" | "ttfb";

/** Google's Core Web Vitals limits at the 75th percentile: milliseconds for LCP and INP, CLS has no unit. */
export const SEO_VITAL_LIMITS = {
  lcp: { good: 2500, poor: 4000 },
  inp: { good: 200, poor: 500 },
  cls: { good: 0.1, poor: 0.25 },
} as const;

export type SeoVitalStatus =
  | "good"
  | "needs_improvement"
  | "poor"
  | "too_little_data";
/** Whose values decide a verdict. Field values of the whole site or of a URL group lead too, under their own name. */
export type SeoSpeedSource = "field" | "fieldOrigin" | "fieldGroup" | "lab";
export type SeoSpeedVerdict = "pass" | "over" | "unknown";

export function isSeoVital(key: SeoSpeedMetric): key is SeoVital {
  return key in SEO_VITAL_LIMITS;
}

/** A value on a limit is inside it, as Google counts it. */
export function seoVitalStatus(
  metric: SeoVital,
  value: number | null | undefined,
): SeoVitalStatus {
  if (value == null) return "too_little_data";
  const { good, poor } = SEO_VITAL_LIMITS[metric];
  return value <= good ? "good" : value <= poor ? "needs_improvement" : "poor";
}

export function seoSpeedValue(key: SeoSpeedMetric, value: number) {
  if (key === "cls")
    return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (key === "tbt" || key === "inp" || key === "ttfb")
    return value.toLocaleString("en-US", { maximumFractionDigits: 1 }) + " ms";
  return (
    (value / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " s"
  );
}

/** The calendar day of a value the client types as a Date and Core sends as a string. Null when it is no date. */
export function seoSpeedDay(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

const FIELD_SOURCE = {
  url: "field",
  origin: "fieldOrigin",
  normalized: "fieldGroup",
} as const;
// A lab test has no visitor, so it has no INP.
const LAB_VITALS = ["lcp", "cls"] as const;
const WORST_FIRST: SeoVitalStatus[] = [
  "poor",
  "needs_improvement",
  "too_little_data",
  "good",
];

export interface SeoDeviceVerdict {
  device: SeoSpeedDevice["device"];
  /** Null: neither real visitors nor the lab test gave a Core Web Vital. */
  source: SeoSpeedSource | null;
  vitals: { metric: SeoVital; value: number | null; status: SeoVitalStatus }[];
  verdict: SeoSpeedVerdict;
  /** The vitals over their good limit, in the order LCP, INP, CLS. */
  over: SeoVital[];
  /** The status of the mark beside the verdict. */
  worst: SeoVitalStatus;
}

/**
 * Real visitors lead when Google measured one Core Web Vital for them; the lab test is the fallback.
 * A pass needs LCP and CLS: INP may lack data, a page with few interactions has none.
 */
export function seoDeviceVerdict({
  device,
  lab,
  field,
}: SeoSpeedDevice): SeoDeviceVerdict {
  const visitors =
    field.status === "measured" &&
    SEO_VITALS.some((metric) => field.p75[metric] != null)
      ? field
      : null;
  const test =
    !visitors &&
    lab.status === "measured" &&
    LAB_VITALS.some((metric) => lab.median[metric] != null)
      ? lab.median
      : null;
  const values: Partial<Record<SeoVital, number | null>> =
    visitors?.p75 ?? test ?? {};
  const metrics = visitors ? SEO_VITALS : test ? LAB_VITALS : [];
  const vitals = metrics.map((metric) => ({
    metric,
    value: values[metric] ?? null,
    status: seoVitalStatus(metric, values[metric]),
  }));
  const over = vitals
    .filter(({ status }) => status === "poor" || status === "needs_improvement")
    .map(({ metric }) => metric);
  const verdict = over.length
    ? "over"
    : values.lcp != null && values.cls != null
      ? "pass"
      : "unknown";
  return {
    device,
    source: visitors ? FIELD_SOURCE[visitors.level] : test ? "lab" : null,
    vitals,
    verdict,
    over,
    worst: vitals.some(({ status }) => status === "poor")
      ? "poor"
      : verdict === "over"
        ? "needs_improvement"
        : verdict === "pass"
          ? "good"
          : "too_little_data",
  };
}

export interface SeoPageVerdict {
  verdict: SeoSpeedVerdict;
  over: SeoVital[];
  worst: SeoVitalStatus;
  /** The source of the devices that decided the verdict. Null: no device decided one. */
  source: SeoSpeedSource | "mixed" | null;
  devices: SeoDeviceVerdict[];
}

/** One device over a limit puts the page over it: a good device does not hide a slow one. */
export function seoPageVerdict(rows: SeoSpeedDevice[]): SeoPageVerdict {
  const devices = rows.map(seoDeviceVerdict);
  const verdict = devices.some((device) => device.verdict === "over")
    ? "over"
    : devices.some((device) => device.verdict === "pass")
      ? "pass"
      : "unknown";
  const deciding =
    verdict === "unknown"
      ? []
      : devices.filter((device) => device.verdict === verdict);
  const sources = new Set(deciding.map((device) => device.source));
  const over = new Set(deciding.flatMap((device) => device.over));
  return {
    verdict,
    over: SEO_VITALS.filter((metric) => over.has(metric)),
    worst:
      WORST_FIRST.find((status) =>
        deciding.some((device) => device.worst === status),
      ) ?? "too_little_data",
    source: sources.size > 1 ? "mixed" : (deciding[0]?.source ?? null),
    devices,
  };
}

/** The table's rows: the slowest pages lead, then the pages without a verdict; pages of the audit before added ones. */
export function seoSiteSpeedRows(siteSpeed: ProjectSeoSiteSpeed) {
  return siteSpeed.rows
    .map((row) => ({
      row,
      verdict: seoPageVerdict(row.devices),
      trend: seoPageTrend(row.devices),
      /** Core sent earlier weeks for a device, comparable or not. */
      history: row.devices.some(
        ({ field }) => field.status === "measured" && field.history != null,
      ),
    }))
    .sort(
      (a, b) =>
        WORST_FIRST.indexOf(a.verdict.worst) -
          WORST_FIRST.indexOf(b.verdict.worst) ||
        Number(b.row.audited) - Number(a.row.audited),
    );
}

export type SeoSpeedHistory = NonNullable<
  Extract<SeoSpeedDevice["field"], { status: "measured" }>["history"]
>;
export type SeoTrendDirection = "better" | "worse" | "steady";

/** Weeks with a value that a trend needs: one value is a point, not a trend. */
const SEO_TREND_MIN_POINTS = 2;
/** A change under this share of the first value, or under the floor of its vital, is noise between two weeks. */
const SEO_TREND_STEADY_SHARE = 0.1;
const SEO_TREND_STEADY_FLOOR = { lcp: 200, inp: 25, cls: 0.02 } as const;
/** Room over the highest value, so the line and the limit do not lie on the edge of the chart. */
const SEO_TREND_HEADROOM = 1.1;

export interface SeoTrendPoint {
  week: string;
  value: number;
}

export type SeoVitalTrend =
  | {
      chart: true;
      direction: SeoTrendDirection;
      first: SeoTrendPoint;
      last: SeoTrendPoint;
      /**
       * One point per week, both axes 0 to 1 with y 0 at the top. A null y is a week without a value: the line breaks there.
       * `alone`: a value with no value in the week before and after it. It lies on no line, so the chart draws a dot.
       */
      points: { x: number; y: number | null; alone: boolean }[];
      /** The y of the good limit: always inside the chart. */
      limit: number;
    }
  | {
      chart: false;
      reason: Exclude<SeoSpeedHistory["status"], "comparable"> | "too_few";
    };

/** The weekly values of one Core Web Vital for real visitors. A lower value is the better one for each vital. */
export function seoVitalTrend(
  metric: SeoVital,
  history: SeoSpeedHistory,
): SeoVitalTrend {
  if (history.status !== "comparable")
    return { chart: false, reason: history.status };
  const weeks = history.weeks ?? [];
  const values = weeks.map((_, index) => history[metric]?.[index] ?? null);
  const measured = weeks.flatMap((week, index) => {
    const value = values[index];
    return value == null ? [] : [{ week, value }];
  });
  const first = measured[0];
  const last = measured.at(-1);
  if (!first || !last || measured.length < SEO_TREND_MIN_POINTS)
    return { chart: false, reason: "too_few" };
  const { good } = SEO_VITAL_LIMITS[metric];
  // The share of the highest value comes first: a product with the headroom can leave the number range.
  const top = Math.max(good, ...measured.map(({ value }) => value));
  const height = (value: number) => 1 - value / top / SEO_TREND_HEADROOM;
  const change = last.value - first.value;
  const noise = Math.max(
    first.value * SEO_TREND_STEADY_SHARE,
    SEO_TREND_STEADY_FLOOR[metric],
  );
  return {
    chart: true,
    direction:
      Math.abs(change) <= noise ? "steady" : change < 0 ? "better" : "worse",
    first,
    last,
    points: values.map((value, index) => ({
      x: weeks.length > 1 ? index / (weeks.length - 1) : 0,
      y: value == null ? null : height(value),
      alone:
        value != null && values[index - 1] == null && values[index + 1] == null,
    })),
    limit: height(good),
  };
}

/**
 * The measurements of an audit that the site speed table does not show. The table shows a page and device
 * once; a measured page that is not in the table keeps its place in the research panel.
 */
export function seoSpeedOutsideTable(
  rows: SeoSpeedDevice[] | undefined,
  table: { rows: { devices: SeoSpeedDevice[] }[] } | null | undefined,
) {
  const key = (row: SeoSpeedDevice) => `${row.device} ${row.pageUrl}`;
  const shown = new Set(table?.rows.flatMap(({ devices }) => devices.map(key)));
  return rows?.filter((row) => !shown.has(key(row)));
}

/** A page's trend in one word: one vital that gets slower on one device outweighs the ones that get faster. Null: no vital has a trend. */
export function seoPageTrend(
  devices: SeoSpeedDevice[],
): SeoTrendDirection | null {
  const directions = devices.flatMap(({ field }) => {
    const history = field.status === "measured" ? field.history : undefined;
    if (!history) return [];
    return SEO_VITALS.flatMap((metric) => {
      const trend = seoVitalTrend(metric, history);
      return trend.chart ? [trend.direction] : [];
    });
  });
  return (
    (["worse", "better", "steady"] as const).find((direction) =>
      directions.includes(direction),
    ) ?? null
  );
}

/** Why a page with the short check was read on its one device. The share is that device's part of the visits, when Google gave one. */
export function seoDeviceReason(check: NonNullable<SeoSiteSpeedRow["check"]>) {
  const share =
    check.mix?.[check.device === "mobile" ? "phone" : "desktop"] ?? null;
  const counted = check.basis === "crux-url" || check.basis === "crux-origin";
  // A reason that names a share cannot stand without one.
  return {
    basis: counted && share == null ? ("default" as const) : check.basis,
    share,
  };
}
