"use client";

import {
  formatDistanceToNow,
  formatDistanceToNowStrict,
  type Locale,
} from "date-fns";
import { de, enUS, es } from "date-fns/locale";
import { Suspense, use } from "react";
import { browser } from "react-dom";

import { formatShortDateTime } from "@/lib/utils/datetime";

/**
 * Maps the app's next-intl locales to their date-fns counterparts so the
 * relative string is localized to match the rest of the UI. Falls back to
 * English for any locale without a mapping.
 */
const DATE_FNS_LOCALES: Record<string, Locale> = {
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
   * Active UI locale. Drives both the SSR-stable absolute-date fallback and
   * the post-hydration relative string. Defaults to `"en"`.
   */
  locale?: string;
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
  absolute: string;
  addSuffix: boolean;
  strict: boolean;
  locale: string;
  className?: string;
}

function TimeAgoRelative({
  dateObj,
  absolute,
  addSuffix,
  strict,
  locale,
  className,
}: TimeAgoRelativeProps) {
  use(browser());
  const dateFnsLocale = DATE_FNS_LOCALES[locale] ?? enUS;
  const label = strict
    ? formatDistanceToNowStrict(dateObj, { addSuffix, locale: dateFnsLocale })
    : formatDistanceToNow(dateObj, { addSuffix, locale: dateFnsLocale });

  return (
    <TimeAgoStamp
      dateObj={dateObj}
      label={label}
      title={absolute}
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
 * of SSR; the nearest Suspense fallback is a UTC-pinned absolute date so the
 * initial HTML stays deterministic.
 */
export function TimeAgo({
  date,
  addSuffix = true,
  strict = false,
  locale = "en",
  className,
}: TimeAgoProps) {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(dateObj.getTime())) {
    return <span className={className}>—</span>;
  }

  const absolute = formatShortDateTime(dateObj, locale);

  return (
    <Suspense
      fallback={
        <TimeAgoStamp
          dateObj={dateObj}
          label={absolute}
          title={absolute}
          className={className}
        />
      }
    >
      <TimeAgoRelative
        dateObj={dateObj}
        absolute={absolute}
        addSuffix={addSuffix}
        strict={strict}
        locale={locale}
        className={className}
      />
    </Suspense>
  );
}
