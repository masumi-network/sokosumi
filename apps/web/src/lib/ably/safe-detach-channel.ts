/**
 * Ably attach/detach races reject with ErrorInfo code 90000 / status 409 when
 * the opposite operation wins (SOKOSUMI-QK, SOKOSUMI-QQ). Detach timeout and
 * already-detached states are also expected during fast membership sync and
 * unmount. None of these are product bugs.
 */
const EXPECTED_ABLY_CHANNEL_LIFECYCLE_MESSAGE_PATTERNS: RegExp[] = [
  /attach request superseded by a subsequent detach request/i,
  /detach request superseded by a subsequent attach request/i,
  /^channel detached\.?$/i,
  /channel detach timed out/i,
  /channel operation failed as channel state is failed/i,
  /connection to server unavailable/i,
  /^connection closed\.?$/i,
];

/** Ably ErrorInfo-shaped errors use numeric `code` (e.g. 90000) and statusCode. */
interface AblyErrorLike {
  message?: string;
  code?: number;
  statusCode?: number;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as AblyErrorLike).message === "string"
  ) {
    return (error as AblyErrorLike).message ?? "";
  }
  return "";
}

export function isExpectedAblyChannelLifecycleError(error: unknown): boolean {
  const message = getErrorMessage(error);
  if (
    EXPECTED_ABLY_CHANNEL_LIFECYCLE_MESSAGE_PATTERNS.some((pattern) =>
      pattern.test(message),
    )
  ) {
    return true;
  }

  // Conflict on attach/detach supersede (ErrorInfo 90000 / HTTP 409).
  if (typeof error === "object" && error !== null) {
    const code = (error as AblyErrorLike).code;
    const statusCode = (error as AblyErrorLike).statusCode;
    if (code === 90000 && statusCode === 409) {
      return true;
    }
  }

  return false;
}

interface DetachableChannel {
  detach: () => Promise<unknown> | unknown;
}

/**
 * Fire-and-forget detach that never leaves an unhandled rejection.
 * Unexpected failures are logged; lifecycle races are swallowed.
 */
export function safeDetachChannel(channel: DetachableChannel): void {
  try {
    const result = channel.detach();
    if (
      result != null &&
      typeof result === "object" &&
      "then" in result &&
      typeof (result as PromiseLike<unknown>).then === "function"
    ) {
      void Promise.resolve(result).catch((error: unknown) => {
        if (!isExpectedAblyChannelLifecycleError(error)) {
          console.error("Ably channel detach failed", error);
        }
      });
    }
  } catch (error) {
    if (!isExpectedAblyChannelLifecycleError(error)) {
      console.error("Ably channel detach failed", error);
    }
  }
}
