import type { NativeSeoMetrics } from "@/schemas/project-seo-native-metrics.schema";
import type { AuditClickHistory } from "@/schemas/seo-audit-performance.schema";
import { withinSearchConsoleRetention } from "./native-statistics";

const MIN_CLICK_CHANGE = 10;
const MIN_RELATIVE_CHANGE = 0.2;
const DAY_MS = 86_400_000;
const MATCHED_WEEKDAY_YEAR_DAYS = 52 * 7;

function movement(current: number, baseline: number) {
  const difference = current - baseline;
  if (
    Math.abs(difference) <
    Math.max(MIN_CLICK_CHANGE, baseline * MIN_RELATIVE_CHANGE)
  )
    return null;
  return difference > 0 ? "recent_click_growth" : "recent_click_decline";
}

function yearEarlier(day: string) {
  return new Date(Date.parse(day) - MATCHED_WEEKDAY_YEAR_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Check the same weekdays last year only when the result can change the audit's next action. */
export async function collectAuditClickHistory(
  metrics: NativeSeoMetrics,
  readDays: (window: {
    from: string;
    to: string;
  }) => Promise<{ date: string; value: number | null }[]>,
): Promise<AuditClickHistory | undefined> {
  const clicks = metrics.metrics.find((metric) => metric.key === "clicks");
  if (clicks?.value == null || clicks.previous?.value == null) return;
  const reason = movement(clicks.value, clicks.previous.value);
  if (!reason) return;
  const window = {
    from: yearEarlier(metrics.from),
    to: yearEarlier(metrics.to),
  };
  const missing: AuditClickHistory = {
    ...window,
    reason,
    coverage: "unavailable",
    clicks: null,
    decision: "insufficient_history",
  };
  if (!withinSearchConsoleRetention(window.from)) return missing;
  let points;
  try {
    points = await readDays(window);
  } catch {
    return missing;
  }
  if (!points.length) return missing;
  // The native normalizer has already checked that dates are distinct and inside the period.
  const expectedDays =
    Math.round((Date.parse(window.to) - Date.parse(window.from)) / DAY_MS) + 1;
  let total = 0;
  for (const point of points) {
    if (
      point.value === null ||
      !Number.isSafeInteger(point.value) ||
      point.value < 0
    )
      return { ...missing, coverage: "partial" };
    total += point.value;
  }
  if (points.length !== expectedDays || !Number.isSafeInteger(total))
    return { ...missing, coverage: "partial" };
  const confirmed = movement(clicks.value, total) === reason;
  return {
    ...window,
    reason,
    clicks: total,
    coverage: "complete",
    decision: !confirmed
      ? "monitor"
      : reason === "recent_click_growth"
        ? "investigate_growth"
        : "investigate_loss",
  };
}
