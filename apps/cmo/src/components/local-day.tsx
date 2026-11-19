"use client";

import { useSyncExternalStore } from "react";
import { runDay } from "../lib/run-day";

const never = () => () => {};

interface LocalDayProps {
  at: Date | string;
  /** The zone the server writes the day in; it cannot know the reader's. */
  serverZone: string | null;
  /** A run's start: the day with its time, "Monday 23 November at 09:00". */
  time?: boolean;
}

/** A day as the reader's own clock has it: "Monday 23 November". */
export function LocalDay({ at, serverZone, time = false }: LocalDayProps) {
  const text = useSyncExternalStore(
    never,
    () => runDay(at, undefined, { time }),
    () => runDay(at, serverZone ?? "UTC", { time }),
  );
  return <time dateTime={new Date(at).toISOString()}>{text}</time>;
}

/** "14:02" today, "Mon 5 Oct, 14:02" before. */
function stamp(at: string, timeZone?: string): string {
  const zone = timeZone ? { timeZone } : {};
  const date = new Date(at);
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    ...zone,
  });
  const sameDay =
    date.toLocaleDateString("en-CA", zone) ===
    new Date().toLocaleDateString("en-CA", zone);
  if (sameDay) return time;
  const on = date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...zone,
  });
  return `${on}, ${time}`;
}

/**
 * When a message was sent, on the reader's own clock. The server writes UTC;
 * the browser replaces it, so old and new messages share one clock.
 */
export function LocalStamp({ at }: { at: string }) {
  const text = useSyncExternalStore(
    never,
    () => stamp(at),
    () => stamp(at, "UTC"),
  );
  return <time dateTime={at}>{text}</time>;
}
