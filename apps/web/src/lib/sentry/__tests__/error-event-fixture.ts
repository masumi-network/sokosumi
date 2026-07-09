import type { ErrorEvent } from "@sentry/nextjs";

/** Minimal ErrorEvent stub for Sentry filter unit tests. */
export function createErrorEvent(event: Omit<ErrorEvent, "type">): ErrorEvent {
  return { type: undefined, ...event };
}
