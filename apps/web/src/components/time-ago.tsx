"use client";

import { formatDistanceToNow, formatDistanceToNowStrict } from "date-fns";
import { useEffect, useState } from "react";

import { formatShortDateTime } from "@/lib/utils/datetime";

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
  /** Locale used for the SSR-stable absolute-date fallback. */
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
  const label = mounted
    ? strict
      ? formatDistanceToNowStrict(dateObj, { addSuffix })
      : formatDistanceToNow(dateObj, { addSuffix })
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
