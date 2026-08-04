"use client";

import {
  formatDistanceToNow,
  formatDistanceToNowStrict,
  type Locale,
} from "date-fns";
import { de, enUS, es } from "date-fns/locale";
import { useEffect, useState } from "react";

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
   * the post-mount relative string. Defaults to `"en"`.
   */
  locale?: string;
  className?: string;
}

/**
 * Renders a relative "time ago" string that is safe to server-render.
 *
 * Relative time is derived from the current clock, which advances between the
 * server render and the client hydration. Computing it during SSR and again
 * during hydration therefore yields different text and triggers a hydration
 * mismatch (Sentry SOKOSUMI-A). To stay deterministic, we render a stable,
 * UTC-pinned absolute date during SSR and the first client render, then swap
 * to the live relative string after mount — a client-only update that cannot
 * mismatch the server output.
 */
export function TimeAgo({
  date,
  addSuffix = true,
  strict = false,
  locale = "en",
  className,
}: TimeAgoProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const dateObj = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(dateObj.getTime())) {
    return <span className={className}>—</span>;
  }

  const absolute = formatShortDateTime(dateObj, locale);
  const dateFnsLocale = DATE_FNS_LOCALES[locale] ?? enUS;
  const label = mounted
    ? strict
      ? formatDistanceToNowStrict(dateObj, { addSuffix, locale: dateFnsLocale })
      : formatDistanceToNow(dateObj, { addSuffix, locale: dateFnsLocale })
    : absolute;

  return (
    <time
      dateTime={dateObj.toISOString()}
      title={absolute}
      className={className}
    >
      {label}
    </time>
  );
}
