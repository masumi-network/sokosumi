import {
  ComposioApiError,
  ComposioPublishOutcomeUnknownError,
  ComposioToolError,
} from "@/clients/composio.client";

const SUMMARY_LIMIT = 300;
const UNKNOWN_SUMMARY = "Unexpected error while publishing";

export interface PublishErrorClassification {
  /** Short machine kind stored on the attempt row. */
  kind: string;
  /** Whether a retry within the window may succeed. */
  transient: boolean;
  /** Human-readable, non-secret summary for `lastError`. */
  summary: string;
}

function summarize(value: string | null | undefined): string {
  const flat = (value ?? "").replace(/\s+/g, " ").trim();
  return flat ? flat.slice(0, SUMMARY_LIMIT) : UNKNOWN_SUMMARY;
}

function classifyApiError(error: ComposioApiError): PublishErrorClassification {
  const summary = summarize(error.message);
  if (error.httpStatus === 429) {
    return { kind: "rate_limited", transient: true, summary };
  }
  if (error.httpStatus === 401 || error.httpStatus === 403) {
    return { kind: "unauthorized", transient: false, summary };
  }
  if (error.httpStatus >= 500) {
    return {
      kind: /timed out|timeout/i.test(error.message)
        ? "timeout"
        : "provider_unavailable",
      transient: true,
      summary,
    };
  }
  return { kind: "rejected", transient: false, summary };
}

function classifyToolError(
  error: ComposioToolError,
): PublishErrorClassification {
  const providerMessage = error.providerMessage ?? "";
  const status = error.providerStatus;
  const summary = summarize(
    providerMessage
      ? `X rejected the post${status ? ` (${status})` : ""}: ${providerMessage}`
      : error.message,
  );
  if (status === 429 || /rate.?limit|\b429\b/i.test(providerMessage)) {
    return { kind: "rate_limited", transient: true, summary };
  }
  if (/time.?out|timed out/i.test(providerMessage)) {
    return { kind: "timeout", transient: true, summary };
  }
  if (status === 503 || /\b503\b|temporarily/i.test(providerMessage)) {
    return { kind: "provider_unavailable", transient: true, summary };
  }
  return { kind: "rejected", transient: false, summary };
}

/**
 * Maps a publish failure to a retry decision. Unknown errors count as
 * transient so a bug does not burn a post on its first try; the attempt cap
 * still bounds them.
 */
export function classifyPublishError(
  error: unknown,
): PublishErrorClassification {
  if (error instanceof ComposioPublishOutcomeUnknownError) {
    return { kind: "unknown", transient: false, summary: error.message };
  }
  if (error instanceof ComposioApiError) return classifyApiError(error);
  if (error instanceof ComposioToolError) return classifyToolError(error);
  return {
    kind: "unknown",
    transient: true,
    summary: summarize(error instanceof Error ? error.message : null),
  };
}
