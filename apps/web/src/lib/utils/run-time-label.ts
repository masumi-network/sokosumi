import type { useFormatter } from "next-intl";

export type RunTimeLabelKey =
  | "overdue"
  | "inMinutes"
  | "inHours"
  | "tomorrowAt"
  | "at";

/**
 * Relative label for an upcoming start: minutes or hours while it is close,
 * "tomorrow at" for tomorrow, else a date and time. Each caller maps the keys
 * onto its own copy, so a schedule's next run and a Task's Run at share the
 * thresholds without sharing wording.
 */
export function formatRunTimeLabel(
  at: Date,
  formatter: Pick<ReturnType<typeof useFormatter>, "dateTime">,
  t: (key: RunTimeLabelKey, values?: Record<string, number | string>) => string,
  now: Date = new Date(),
): string {
  const diffMs = at.getTime() - now.getTime();

  if (diffMs <= 0) {
    return t("overdue");
  }

  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;

  if (diffMs < oneHour) {
    return t("inMinutes", {
      minutes: Math.max(1, Math.ceil(diffMs / (60 * 1000))),
    });
  }

  if (diffMs < oneDay) {
    return t("inHours", { hours: Math.max(1, Math.ceil(diffMs / oneHour)) });
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    at.getFullYear() === tomorrow.getFullYear() &&
    at.getMonth() === tomorrow.getMonth() &&
    at.getDate() === tomorrow.getDate();

  if (isTomorrow) {
    return t("tomorrowAt", { time: formatter.dateTime(at, "time") });
  }

  return t("at", { datetime: formatter.dateTime(at, "dateTime") });
}
