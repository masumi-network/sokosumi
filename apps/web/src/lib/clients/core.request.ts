import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import type { Client } from "@/lib/clients/generated/core/client";

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

  constructor(
    message: string,
    options?: { details?: unknown; kind?: string; status?: number },
  ) {
    super(message);
    this.name = "CoreApiRequestError";
    this.details = options?.details;
    this.kind = options?.kind;
    this.status = options?.status;
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

export async function executeCoreOperation<TData, TError>(
  getClient: GetCoreClient,
  operation: (client: Client) => Promise<CoreOperationResult<TData, TError>>,
  fallbackMessage: string,
): Promise<TData> {
  const client = await getClient();

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
    });
  }

  return result.data as TData;
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
