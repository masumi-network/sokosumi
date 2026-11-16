"use client";

import { formatDistance, formatDistanceStrict, type Locale } from "date-fns";
import { de, enUS, es } from "date-fns/locale";
import { useFormatter, useLocale } from "next-intl";
import { Suspense, use } from "react";
import { browser } from "react-dom";

/**
 * Maps the app's next-intl locales to their date-fns counterparts so the
 * relative string is localized to match the rest of the UI. Falls back to
 * English for any locale without a mapping.
 */
export const DATE_FNS_LOCALES: Record<string, Locale> = {
  de,
  en: enUS,
  es,
};

interface TimeAgoProps {
  /** The timestamp to render relative to the current time. */
  date: string | Date;
  /** Append an "ago"/"in" suffix. Defaults to true. */
  addSuffix?: boolean;
  /**
   * Use date-fns `formatDistanceToNowStrict` (a single, exact unit) instead
   * of `formatDistanceToNow` (which adds "about", "almost", etc.). Defaults
   * to false.
   */
  strict?: boolean;
  /**
   * Names what the timestamp measures in the hover title, e.g. "Last
   * activity". Without it the title is the absolute stamp alone.
   */
  titlePrefix?: string;
  /**
   * Measure against this time instead of the clock at render. Pass a ticking
   * value (`useNow`) to keep the label current: a memoized render won't.
   */
  now?: Date;
  className?: string;
}

interface TimeAgoStampProps {
  dateObj: Date;
  label: string;
  title: string;
  className?: string;
}

function TimeAgoStamp({ dateObj, label, title, className }: TimeAgoStampProps) {
  return (
    <time dateTime={dateObj.toISOString()} title={title} className={className}>
      {label}
    </time>
  );
}

interface TimeAgoRelativeProps {
  dateObj: Date;
  title: string;
  addSuffix: boolean;
  strict: boolean;
  locale: string;
  now?: Date;
  className?: string;
}

function TimeAgoRelative({
  dateObj,
  title,
  addSuffix,
  strict,
  locale,
  now,
  className,
}: TimeAgoRelativeProps) {
  use(browser());
  const options = { addSuffix, locale: DATE_FNS_LOCALES[locale] ?? enUS };
  // A tick older than the date (a status that just reset) would read as a
  // stale distance; the real clock gives the near-zero answer.
  const base = now && now > dateObj ? now : new Date();
  const label = strict
    ? formatDistanceStrict(dateObj, base, options)
    : formatDistance(dateObj, base, options);

  return (
    <TimeAgoStamp
      dateObj={dateObj}
      label={label}
      title={title}
      className={className}
    />
  );
}

/**
 * Renders a relative "time ago" string that is safe to server-render.
 *
 * Relative time is derived from the current clock, which advances between the
 * server render and the client hydration. Computing it during SSR therefore
 * yields different text than the first client render and triggers a hydration
 * mismatch (Sentry SOKOSUMI-A). `use(browser())` opts the relative string out
 * of SSR; the nearest Suspense fallback is an absolute date in the request's
 * zone and hour cycle (see `TimeZoneSync`, `TimeFormatSync`) so the initial
 * HTML stays deterministic.
 */
export function TimeAgo({
  date,
  addSuffix = true,
  strict = false,
  titlePrefix,
  now,
  className,
}: TimeAgoProps) {
  const format = useFormatter();
  const locale = useLocale();
  const dateObj = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(dateObj.getTime())) {
    return <span className={className}>—</span>;
  }

  const absolute = format.dateTime(dateObj, "dateTime");
  const title = titlePrefix ? `${titlePrefix}: ${absolute}` : absolute;

  return (
    <Suspense
      fallback={
        <TimeAgoStamp
          dateObj={dateObj}
          label={absolute}
          title={title}
          className={className}
        />
      }
    >
      <TimeAgoRelative
        dateObj={dateObj}
        title={title}
        addSuffix={addSuffix}
        strict={strict}
        locale={locale}
        now={now}
        className={className}
      />
    </Suspense>
  );
}
