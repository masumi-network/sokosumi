"use client";

import { useFormatter, useTranslations } from "next-intl";
import { seoResultFormat } from "@/i18n/seo-result-messages";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";

function MissingReportValue() {
  const result = useSeoResultTranslations("App.Seo");
  return <span lang="en">{result("none")}</span>;
}

export function SeoDate({
  value,
  timeZone,
  day,
  report,
}: {
  report?: boolean;
  value: string | Date | null;
  timeZone?: string;
  /** The day alone. Two reads of one check differ by minutes; a line that dates the check must not. */
  day?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const local = useFormatter();
  const english = useSeoResultFormatter();
  const format = report ? english : local;
  if (!value) return report ? <MissingReportValue /> : <span>{t("none")}</span>;
  const date = value instanceof Date ? value : new Date(value);
  return (
    <time lang={report ? "en" : undefined} dateTime={date.toISOString()}>
      {day
        ? format.dateTime(date, {
            dateStyle: "medium",
            ...(timeZone ? { timeZone } : {}),
          })
        : format.dateTime(
            date,
            "dateTimeMedium",
            timeZone ? { timeZone } : undefined,
          )}
    </time>
  );
}

/** A reporting period of calendar days, shown as the provider's dates without a time zone shift. */
export function SeoPeriod({
  from,
  to,
  report,
}: {
  from: string;
  to: string;
  report?: boolean;
}) {
  const interfaceFormat = useFormatter();
  const format = report ? seoResultFormat : interfaceFormat;
  const day = (value: string) => new Date(`${value}T12:00:00Z`);
  // The locale picks the range form and its separator.
  return (
    <span lang={report ? "en" : undefined}>
      {format.dateTimeRange(day(from), day(to), {
        dateStyle: "medium",
        timeZone: "UTC",
      })}
    </span>
  );
}
