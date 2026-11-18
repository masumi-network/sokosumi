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
