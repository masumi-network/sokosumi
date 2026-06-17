/** Default outbound webhook request timeout when callers omit `timeoutMs`. */
export const DEFAULT_WEBHOOK_TIMEOUT_MS = 10_000;

/** Response bodies longer than this are truncated before being reported. */
export const MAX_REPORTED_WEBHOOK_BODY_LENGTH = 500;

export interface PostWebhookOptions {
  /** Value sent as the `User-Agent` request header. */
  userAgent: string;
  /** Abort the request after this many milliseconds. Defaults to 10s. */
  timeoutMs?: number;
}

/**
 * Outcome of a {@link postWebhook} call. Callers map each variant onto their own
 * reporting sink (e.g. Sentry `captureMessage` in web and core); the transport
 * itself never logs.
 */
export type PostWebhookResult =
  | { status: "ok"; httpStatus: number }
  | {
      status: "backpressure";
      httpStatus: number;
      statusText: string;
      body: string;
    }
  | {
      status: "failed";
      error: Error;
      httpStatus?: number;
      statusText?: string;
      body?: string;
    };

/**
 * Reads the response body, swallowing read errors. Consuming the body prevents
 * connection leaks even when the caller does not need its contents.
 */
async function consumeResponseBody(response: Response): Promise<string | null> {
  try {
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Detects the receiver's "queue full" backpressure signal: an HTTP 400 whose
 * body mentions both "queue" and "full". Such responses are expected under load
 * and should not be reported as failures.
 */
function isWebhookBackpressureResponse(
  httpStatus: number,
  body: string | null,
): boolean {
  if (httpStatus !== 400 || !body) return false;

  const normalizedBody = body.toLowerCase();
  return normalizedBody.includes("queue") && normalizedBody.includes("full");
}

/**
 * Framework-agnostic webhook transport: POSTs a JSON payload with timeout
 * protection and classifies the outcome as `ok`, `backpressure`, or `failed`.
 *
 * The body is always consumed to avoid connection leaks. This helper performs
 * no logging — callers map {@link PostWebhookResult} onto their own error sink.
 */
export async function postWebhook(
  webhookUrl: string,
  payload: unknown,
  options: PostWebhookOptions,
): Promise<PostWebhookResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": options.userAgent,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const body = await consumeResponseBody(response);

    if (response.ok) {
      return { status: "ok", httpStatus: response.status };
    }

    if (isWebhookBackpressureResponse(response.status, body)) {
      return {
        status: "backpressure",
        httpStatus: response.status,
        statusText: response.statusText,
        body: body ?? "",
      };
    }

    return {
      status: "failed",
      error: new Error(
        `Webhook responded with ${response.status} ${response.statusText}`,
      ),
      httpStatus: response.status,
      statusText: response.statusText,
      body: body ?? undefined,
    };
  } catch (fetchError) {
    let error: Error;
    if (fetchError instanceof Error) {
      error =
        fetchError.name === "AbortError"
          ? new Error(`Webhook request timed out after ${timeoutMs}ms`)
          : fetchError;
    } else {
      error = new Error(String(fetchError));
    }

    return { status: "failed", error };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Builds a structured context object describing a failed webhook call, suitable
 * for attaching to an error report (e.g. Sentry `extra`). The response body is
 * truncated to {@link MAX_REPORTED_WEBHOOK_BODY_LENGTH}. Reporting itself stays
 * with the caller so each app can use its own Sentry SDK.
 *
 * @param result - The failed result returned by {@link postWebhook}.
 * @param base - Caller-supplied fields (e.g. `webhookType`, `webhookUrl`) merged
 *   into the context.
 */
export function buildWebhookFailureContext(
  result: Extract<PostWebhookResult, { status: "failed" }>,
  base: Record<string, unknown> = {},
): Record<string, unknown> {
  const context: Record<string, unknown> = {
    ...base,
    error: result.error.message,
  };

  if (result.httpStatus !== undefined) {
    context.responseStatus = result.httpStatus;
    context.responseStatusText = result.statusText;
    if (result.body) {
      context.responseBody =
        result.body.length > MAX_REPORTED_WEBHOOK_BODY_LENGTH
          ? `${result.body.substring(0, MAX_REPORTED_WEBHOOK_BODY_LENGTH)}... (truncated)`
          : result.body;
    }
  }

  return context;
}
