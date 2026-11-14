import type { useFormatter } from "next-intl";

/**
 * Two days as the two ends of one line. Days of one year say the year once: with both, the line took two lines
 * on a phone. Both days have one form: the medium date style of German is all numbers, beside a month name.
 */
export function seoDaySpan(
  format: ReturnType<typeof useFormatter>,
  from: string | Date,
  to: string | Date,
) {
  const part = (value: string | Date, year: boolean) =>
    format.dateTime(new Date(value), {
      month: "short",
      day: "numeric",
      ...(year ? { year: "numeric" } : {}),
    });
  const year = (value: string | Date) =>
    format.dateTime(new Date(value), { year: "numeric" });
  return { from: part(from, year(from) !== year(to)), to: part(to, true) };
}
