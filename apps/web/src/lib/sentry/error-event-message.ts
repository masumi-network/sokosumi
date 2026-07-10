import type { ErrorEvent, EventHint } from "@sentry/nextjs";

export function getSentryErrorEventMessage(
  event: ErrorEvent,
  hint?: EventHint,
): string {
  const exception = event.exception?.values?.[0];
  if (typeof exception?.value === "string" && exception.value.length > 0) {
    return exception.value;
  }

  if (typeof event.message === "string" && event.message.length > 0) {
    return event.message;
  }

  const original = hint?.originalException;
  if (original instanceof Error && original.message.length > 0) {
    return original.message;
  }

  if (typeof original === "string" && original.length > 0) {
    return original;
  }

  if (typeof exception?.type === "string" && exception.type.length > 0) {
    return exception.type;
  }

  return "";
}
