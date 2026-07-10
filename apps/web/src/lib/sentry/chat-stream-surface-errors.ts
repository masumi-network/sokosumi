import type { ErrorEvent } from "@sentry/nextjs";

import { getSentryErrorEventMessage } from "@/lib/sentry/error-event-message";

/**
 * Core coworker chat streams return this copy from
 * `toUIMessageStreamResponse({ onError })`. The AI SDK surfaces it as an
 * unhandled rejection on `/chat` (SOKOSUMI-Q2).
 */
const GENERIC_CHAT_STREAM_ERROR = /^an error occurred\.?$/i;

const AI_SDK_STACK_FILENAME = /ai\/dist\/index\.js/i;

function getStackFrameFilenames(event: ErrorEvent): string[] {
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];

  return frames
    .map((frame) => frame.filename)
    .filter((filename): filename is string => typeof filename === "string");
}

function isChatTransaction(event: ErrorEvent): boolean {
  return (
    typeof event.transaction === "string" &&
    (event.transaction === "/chat" || event.transaction.startsWith("/chat/"))
  );
}

export function isExpectedChatStreamSurfaceError(event: ErrorEvent): boolean {
  if (!GENERIC_CHAT_STREAM_ERROR.test(getSentryErrorEventMessage(event))) {
    return false;
  }

  if (isChatTransaction(event)) {
    return true;
  }

  return getStackFrameFilenames(event).some((filename) =>
    AI_SDK_STACK_FILENAME.test(filename),
  );
}
