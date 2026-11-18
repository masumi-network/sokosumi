"use client";

import { useSyncExternalStore } from "react";

const never = () => () => {};

function day(at: Date | string, timeZone?: string): string {
  return new Date(at).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(timeZone ? { timeZone } : {}),
  });
}

interface LocalDayProps {
  at: Date | string;
  /** The zone the server writes the day in; it cannot know the reader's. */
  serverZone: string | null;
}

/** A day as the reader's own clock has it: "Monday 23 November". */
export function LocalDay({ at, serverZone }: LocalDayProps) {
  const text = useSyncExternalStore(
    never,
    () => day(at),
    () => day(at, serverZone ?? "UTC"),
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
