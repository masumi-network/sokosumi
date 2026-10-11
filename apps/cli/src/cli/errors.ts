export type ErrorCode =
  | "VALIDATION"
  | "AUTH_REQUIRED"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "NETWORK"
  | "API_ERROR"
  | "UNKNOWN";

export const EXIT_CODES: Record<ErrorCode | "OK", number> = {
  OK: 0,
  UNKNOWN: 1,
  VALIDATION: 2,
  AUTH_REQUIRED: 3,
  PERMISSION_DENIED: 4,
  NOT_FOUND: 5,
  NETWORK: 6,
  API_ERROR: 7,
};

export class CliError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}

function statusToCode(status: number): ErrorCode {
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 400 || status === 422) return "VALIDATION";
  return "API_ERROR";
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = (error as { cause?: { code?: unknown } }).cause;
  const causeCode = typeof cause?.code === "string" ? cause.code : "";
  const haystack = `${error.message} ${causeCode}`;
  return /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(
    haystack,
  );
}

export interface ClassifiedError {
  code: ErrorCode;
  exitCode: number;
  status?: number;
}

export function classifyError(error: unknown): ClassifiedError {
  if (error instanceof CliError) {
    return { code: error.code, exitCode: EXIT_CODES[error.code] };
  }
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") {
    const code = statusToCode(status);
    return { code, exitCode: EXIT_CODES[code], status };
  }
  if (isNetworkError(error)) {
    return { code: "NETWORK", exitCode: EXIT_CODES.NETWORK };
  }
  return { code: "UNKNOWN", exitCode: EXIT_CODES.UNKNOWN };
}

export interface JsonErrorPayload {
  error: string;
  code: ErrorCode;
  status?: number;
}

export function buildJsonError(
  message: string,
  error: unknown,
): JsonErrorPayload {
  const { code, status } = classifyError(error);
  return status === undefined
    ? { error: message, code }
    : { error: message, code, status };
}
