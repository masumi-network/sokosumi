import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { parseRetryDelaySeconds } from "@/lib/chat/chat-read-throttle";
import type { Client } from "@/lib/clients/generated/core/client";
import {
  attachCoreRequestIdInterceptor,
  extractCoreRequestId,
} from "@/lib/clients/utils/core-request-id";

export class CoreApiRequestError extends Error {
  details?: unknown;
  /**
   * Stable machine-readable error kind from the Core error envelope (e.g.
   * `organization_not_found`). Prefer matching on this over `message`, which
   * may be reworded at any time. See `CORE_API_ERROR_KINDS` in
   * `@sokosumi/utils`.
   */
  kind?: string;
  status?: number;
  requestId?: string;
  /**
   * Seconds Core asked the client to wait before retrying, from the
   * `Retry-After` header with the error body's `retryAfterSeconds` as
   * fallback. Present only on throttled responses carrying a usable delay.
   */
  retryAfterSeconds?: number;

  constructor(
    message: string,
    options?: {
      details?: unknown;
      kind?: string;
      status?: number;
      requestId?: string;
      retryAfterSeconds?: number;
    },
  ) {
    super(message);
    this.name = "CoreApiRequestError";
    this.details = options?.details;
    this.kind = options?.kind;
    this.status = options?.status;
    this.requestId = options?.requestId;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

type CoreOperationResult<TData, TError> = {
  data?: TData;
  error?: TError;
  /** Present for HTTP outcomes; omitted when the client reports a network-level failure. */
  response?: Response;
};

export type GetCoreClient = () => Client | Promise<Client>;

function extractErrorMessage(error: unknown, status?: number): string {
  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  if (error && typeof error === "object") {
    const typedError = error as {
      error?: unknown;
      message?: unknown;
    };

    if (
      typeof typedError.message === "string" &&
      typedError.message.length > 0
    ) {
      return typedError.message;
    }

    if (typeof typedError.error === "string" && typedError.error.length > 0) {
      return typedError.error;
    }
  }

  if (typeof status === "number") {
    return `API error: ${status}`;
  }

  return "Failed to communicate with Core API";
}

function extractErrorKind(error: unknown): string | undefined {
  if (error && typeof error === "object") {
    const typedError = error as { kind?: unknown };

    if (typeof typedError.kind === "string" && typedError.kind.length > 0) {
      return typedError.kind;
    }
  }

  return undefined;
}

function extractRetryAfterSeconds(
  error: unknown,
  response?: Response,
): number | undefined {
  // The header is authoritative when both are present; Core mirrors the
  // body's delay into it on every throttled response.
  return (
    parseRetryDelaySeconds(response?.headers.get("retry-after")) ??
    parseRetryDelaySeconds(
      error && typeof error === "object"
        ? (error as { retryAfterSeconds?: unknown }).retryAfterSeconds
        : undefined,
    )
  );
}

export interface CoreOperationWithResponse<TData> {
  data: TData;
  /** Present for HTTP outcomes; omitted when the client reports a network-level failure. */
  response?: Response;
}

export async function executeCoreOperation<TData, TError>(
  getClient: GetCoreClient,
  operation: (client: Client) => Promise<CoreOperationResult<TData, TError>>,
  fallbackMessage: string,
): Promise<TData> {
  const { data } = await executeCoreOperationWithResponse(
    getClient,
    operation,
    fallbackMessage,
  );
  return data;
}

/**
 * `executeCoreOperation` that also returns the raw response, for callers
 * that must read response headers (impersonation forwards Set-Cookie).
 * Error behavior is identical.
 */
export async function executeCoreOperationWithResponse<TData, TError>(
  getClient: GetCoreClient,
  operation: (client: Client) => Promise<CoreOperationResult<TData, TError>>,
  fallbackMessage: string,
): Promise<CoreOperationWithResponse<TData>> {
  const client = attachCoreRequestIdInterceptor(await getClient());

  let result: CoreOperationResult<TData, TError>;
  try {
    result = await operation(client);
  } catch (error) {
    throw new CoreApiRequestError(
      error instanceof Error ? error.message : fallbackMessage,
      { details: error },
    );
  }

  if (result.error) {
    const message = extractErrorMessage(result.error, result.response?.status);
    throw new CoreApiRequestError(message, {
      details: result.error,
      kind: extractErrorKind(result.error),
      status: result.response?.status,
      requestId: extractCoreRequestId({
        error: result.error,
        response: result.response,
      }),
      retryAfterSeconds: extractRetryAfterSeconds(
        result.error,
        result.response,
      ),
    });
  }

  const isNoContentSuccess =
    result.response?.ok === true &&
    (result.response.status === 204 || result.response.status === 205);

  if (result.data == null && !isNoContentSuccess) {
    const message = extractErrorMessage(result.error, result.response?.status);
    throw new CoreApiRequestError(message, {
      details: result.error,
      kind: extractErrorKind(result.error),
      status: result.response?.status,
      requestId: extractCoreRequestId({
        error: result.error,
        response: result.response,
      }),
      retryAfterSeconds: extractRetryAfterSeconds(
        result.error,
        result.response,
      ),
    });
  }

  return { data: result.data as TData, response: result.response };
}

export function mapCoreApiStatusToCommonErrorCode(
  status?: number,
): CommonErrorCode {
  switch (status) {
    case 401:
    case 403:
      return CommonErrorCode.UNAUTHORIZED;
    case 404:
      return CommonErrorCode.NOT_FOUND;
    case 400:
    case 409:
    case 422:
      return CommonErrorCode.BAD_INPUT;
    default:
      return CommonErrorCode.INTERNAL_SERVER_ERROR;
  }
}

export function toCoreApiActionError(error: unknown): ActionError {
  if (error instanceof CoreApiRequestError) {
    let message = error.message;

    if (
      error.status === 503 &&
      !message.toLowerCase().includes("unavailable")
    ) {
      message = "The service is currently unavailable.";
    }

    return {
      message,
      code: mapCoreApiStatusToCommonErrorCode(error.status),
      ...(error.kind ? { kind: error.kind } : {}),
    };
  }

  return {
    message:
      error instanceof Error
        ? error.message
        : "Failed to communicate with Core API",
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
  };
}
