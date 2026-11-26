/**
 * Days in each comparison window (owner decision 2026-11-26). Four full weeks,
 * so both windows hold every weekday the same number of times.
 */
export const SEO_IMPACT_WINDOW_DAYS = 28;
/**
 * The window lengths a caller may ask for instead. A week is the shortest
 * span that holds every weekday. A quarter is the longest: a longer window
 * mixes in more of the season than of the change.
 */
export const SEO_IMPACT_MIN_WINDOW_DAYS = 7;
export const SEO_IMPACT_MAX_WINDOW_DAYS = 91;
/**
 * Search Console's final data trails today by about 3 days, so the last 3
 * days of an after-window can still grow.
 */
export const SEO_IMPACT_SETTLE_DAYS = 3;
/**
 * The smallest count each window needs before a percent is shown. Below 30,
 * one search more or less moves the percent by more than 3 points.
 */
export const SEO_IMPACT_MIN_COUNT = 30;

const DAY_MS = 86_400_000;
/** Search Console dates its days in Pacific Time. */
const SEARCH_CONSOLE_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
});

export interface SeoImpactDay {
  date: string;
  clicks: number;
  impressions: number;
  /** Average position of the day. No value on a day without impressions. */
  position: number | null;
}
/** Daily Search Console rows of exactly one page. A day inside the period without a row had no impressions. */
export interface SeoImpactSeries {
  from: string;
  to: string;
  days: SeoImpactDay[];
}
export interface SeoImpactWindow {
  from: string;
  to: string;
}
export interface SeoImpactTotals extends SeoImpactWindow {
  clicks: number;
  impressions: number;
  position: number | null;
}
export type SeoImpactState =
  | "measured"
  | "too_early"
  | "not_measured"
  | "low_counts";
export interface SeoActionImpact {
  anchor: string;
  anchorKind: "completed" | "verified";
  days: number;
  state: SeoImpactState;
  before: SeoImpactTotals | null;
  after: SeoImpactTotals | null;
}

function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * The day the change counts from. The completion of the Task wins: it is when
 * the work was reported done. The verification is the time of a later check,
 * and a check can also pass before the Task closes, so it only stands in when
 * the Task has no completion.
 */
export function seoImpactAnchor(action: {
  completedAt?: string;
  verifiedAt?: string;
}): Pick<SeoActionImpact, "anchor" | "anchorKind"> | null {
  const at = action.completedAt ?? action.verifiedAt;
  if (!at || !Number.isFinite(Date.parse(at))) return null;
  return {
    anchor: SEARCH_CONSOLE_DAY.format(new Date(at)),
    anchorKind: action.completedAt ? "completed" : "verified",
  };
}

/** The anchor day holds both states of the page, so neither window includes it. */
export function seoImpactWindows(
  anchor: string,
  days = SEO_IMPACT_WINDOW_DAYS,
): {
  before: SeoImpactWindow;
  after: SeoImpactWindow;
} {
  return {
    before: {
      from: shiftDay(anchor, -days),
      to: shiftDay(anchor, -1),
    },
    after: {
      from: shiftDay(anchor, 1),
      to: shiftDay(anchor, days),
    },
  };
}

/** The last day Search Console has settled, in its own calendar. */
export function seoImpactSettledDay(now: Date): string {
  return SEARCH_CONSOLE_DAY.format(
    new Date(now.getTime() - SEO_IMPACT_SETTLE_DAYS * DAY_MS),
  );
}

/**
 * Totals of one window, or null when the series do not cover every day of it.
 * Series come newest first: the newest read of a day wins.
 */
export function seoImpactTotals(
  series: readonly SeoImpactSeries[],
  window: SeoImpactWindow,
): SeoImpactTotals | null {
  let clicks = 0;
  let impressions = 0;
  let weighted = 0;
  for (let date = window.from; date <= window.to; date = shiftDay(date, 1)) {
    const source = series.find((item) => item.from <= date && date <= item.to);
    if (!source) return null;
    const day = source.days.find((item) => item.date === date);
    if (!day) continue;
    clicks += day.clicks;
    impressions += day.impressions;
    weighted += (day.position ?? 0) * day.impressions;
  }
  return {
    ...window,
    clicks,
    impressions,
    position: impressions ? weighted / impressions : null,
  };
}

/** The change in percent, or null when either count is under the low-count rule. */
export function seoImpactPercent(before: number, after: number): number | null {
  if (before < SEO_IMPACT_MIN_COUNT || after < SEO_IMPACT_MIN_COUNT)
    return null;
  return Math.round(((after - before) / before) * 100);
}

/** Before and after one done action, from the daily rows of its page alone. */
export function seoActionImpact(
  action: { completedAt?: string; verifiedAt?: string },
  series: readonly SeoImpactSeries[],
  now: Date,
  days = SEO_IMPACT_WINDOW_DAYS,
): SeoActionImpact | null {
  const anchor = seoImpactAnchor(action);
  if (!anchor) return null;
  const windows = seoImpactWindows(anchor.anchor, days);
  const before = seoImpactTotals(series, windows.before);
  const settled = windows.after.to <= seoImpactSettledDay(now);
  const after = settled ? seoImpactTotals(series, windows.after) : null;
  return {
    ...anchor,
    days,
    state: !settled
      ? "too_early"
      : !before || !after
        ? "not_measured"
        : seoImpactPercent(before.impressions, after.impressions) === null
          ? "low_counts"
          : "measured",
    before,
    after,
  };
}
