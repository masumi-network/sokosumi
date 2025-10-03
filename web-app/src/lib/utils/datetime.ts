import { isToday, isYesterday } from "date-fns";
import type { createTranslator } from "next-intl";

interface HumanReadableDateOptions {
  locale?: string;
}

export function getHumanReadableDate(
  dateInput: Date | number,
  t: ReturnType<typeof createTranslator>,
  options?: HumanReadableDateOptions,
): string {
  const date = new Date(dateInput);
  if (isToday(date)) return t("today") ?? "today";
  if (isYesterday(date)) return t("yesterday") ?? "yesterday";

  // Use next-intl's t for today/yesterday, otherwise use Intl.RelativeTimeFormat for relative dates
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffSec = Math.round(diffMs / 1000);

  const { value, unit } = getRelativeTimeParts(diffSec);

  // Use the current locale from next-intl's t object if available, fallback to 'en'
  const locale = options?.locale ?? "en";
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  return rtf.format(value, unit);
}

// Helper to get largest time unit and value
function getRelativeTimeParts(seconds: number): {
  value: number;
  unit: Intl.RelativeTimeFormatUnit;
} {
  const absSec = Math.abs(seconds);
  if (absSec < 60) {
    return { value: Math.round(seconds), unit: "second" };
  }
  const minutes = seconds / 60;
  if (Math.abs(minutes) < 60) {
    return { value: Math.round(minutes), unit: "minute" };
  }
  const hours = minutes / 60;
  if (Math.abs(hours) < 24) {
    return { value: Math.round(hours), unit: "hour" };
  }
  const days = hours / 24;
  if (Math.abs(days) < 30) {
    return { value: Math.round(days), unit: "day" };
  }
  const months = days / 30;
  if (Math.abs(months) < 12) {
    return { value: Math.round(months), unit: "month" };
  }
  const years = months / 12;
  return { value: Math.round(years), unit: "year" };
}
