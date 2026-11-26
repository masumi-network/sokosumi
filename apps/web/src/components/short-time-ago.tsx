"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Suspense, use, useCallback, useSyncExternalStore } from "react";
import { browser } from "react-dom";

const TICK_MS = 60_000;

/**
 * One clock for every short "… ago" on screen, so the sidebar's "Active 2m
 * ago" and Home's rows move together instead of each on its own timer.
 */
let clock = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function tick() {
  clock = Date.now();
  for (const notify of listeners) notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // A label shown between ticks (Home opening beside the sidebar) moves
  // every label to now rather than counting from an older tick.
  if (Date.now() - clock > 1_000) tick();
  timer ??= setInterval(tick, TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function readClock() {
  // Stopped while nothing shows a time: read it fresh, but keep one value for
  // a second so the reads of one render agree.
  if (!timer && Math.abs(Date.now() - clock) > 1_000) clock = Date.now();
  return clock;
}

/** The shared clock, ticking once a minute. Browser only. */
export function useSharedNow(): number {
  return useSyncExternalStore(subscribe, readClock, readClock);
}

/**
 * "just now" under a minute (seconds are noise), then the narrow unit in the
 * reader's locale: "2m ago", "3h ago", "vor 3 Std.".
 */
export function useFormatShortTimeAgo() {
  const t = useTranslations("Components.TimeAgo");
  const format = useFormatter();

  return useCallback(
    (at: Date, now: Date | number) =>
      +now - +at < TICK_MS
        ? t("justNow")
        : format.relativeTime(at, { now, style: "narrow" }),
    [format, t],
  );
}

/**
 * A short, live "… ago". The server counts from `now`, the time the page
 * read; the browser then counts from the shared clock. Each side's own clock
 * would differ by the load and not hydrate (React #418).
 */
export function ShortTimeAgo({ at, now }: { at: Date; now: Date }) {
  const formatShortTimeAgo = useFormatShortTimeAgo();

  return (
    <Suspense fallback={formatShortTimeAgo(at, now)}>
      <LiveShortTimeAgo at={at} now={now} />
    </Suspense>
  );
}

function LiveShortTimeAgo({ at, now }: { at: Date; now: Date }) {
  use(browser());
  const formatShortTimeAgo = useFormatShortTimeAgo();
  // Never behind the server's label: the first render still holds the clock
  // as it was before this label subscribed.
  const clock = Math.max(useSharedNow(), now.getTime());

  return formatShortTimeAgo(at, clock);
}
