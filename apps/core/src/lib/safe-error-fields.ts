import { SOKO_BOT_INTEGRATION_PROVIDERS } from "@sokosumi/soko-bot";

/**
 * What a log event may keep of an error that can quote a mail, a message or a
 * prompt. Every value is matched against a finite, Core-owned set; nothing is
 * copied from the error, and no read on it can throw: an error's properties
 * may be getters or a proxy, and these checks run inside catch blocks.
 */
export interface SafeErrorFields {
  errorName: string;
  code?: string;
  status?: number;
  operation?: string;
}

/**
 * Error classes whose name says what failed without saying anything a user
 * wrote. Any other name is reported as `Error`.
 */
const KNOWN_ERROR_NAMES: ReadonlySet<string> = new Set([
  "Error",
  "AbortError",
  "AggregateError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TimeoutError",
  "TypeError",
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "PrismaClientValidationError",
  // The AI SDK's runtime names, not its class names, for the calls Core makes.
  "AI_APICallError",
  "AI_JSONParseError",
  "AI_NoObjectGeneratedError",
  "AI_NoOutputGeneratedError",
  "AI_RetryError",
  "AI_TypeValidationError",
  "ComposioApiError",
  "ComposioToolError",
  "ModelStreamStalledError",
  "ReleaseClaimLostError",
  "SokoBotModelPolicyError",
  "SokoBotRuntimeUnavailableError",
  "SokoBotTaintedActionError",
]);

function codeRange(prefix: string, from: number, to: number): string[] {
  return Array.from(
    { length: to - from + 1 },
    (_, i) => `${prefix}${from + i}`,
  );
}

/**
 * Machine codes a log may keep: Prisma's documented engine and query codes
 * (P1000–P1003, P1008–P1017, P2000–P2037), and Node's and undici's network
 * codes. A code outside this set is dropped: a format cannot tell a code from
 * an upper-case subject or key.
 */
const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set([
  ...codeRange("P", 1000, 1003),
  ...codeRange("P", 1008, 1017),
  ...codeRange("P", 2000, 2037),
  "ABORT_ERR",
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** Every Composio tool slug Core calls: the only operations a log may name. */
const KNOWN_OPERATIONS: ReadonlySet<string> = new Set(
  SOKO_BOT_INTEGRATION_PROVIDERS.flatMap((provider) =>
    Object.values(provider.tools).filter(
      (slug): slug is string => typeof slug === "string",
    ),
  ),
);

/** `target[key]`, or `undefined` when reading it throws. */
function read(target: unknown, key: string): unknown {
  if (target === null || typeof target !== "object") return undefined;
  try {
    return (target as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function isError(value: unknown): boolean {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

/** The error's class name when it is a known one, else `Error`. */
export function safeErrorName(error: unknown): string {
  const name = isError(error) ? read(error, "name") : undefined;
  return typeof name === "string" && KNOWN_ERROR_NAMES.has(name)
    ? name
    : "Error";
}

/** The error's code when it is a known machine code. */
export function safeErrorCode(error: unknown): string | undefined {
  const code = read(error, "code");
  return typeof code === "string" && KNOWN_ERROR_CODES.has(code)
    ? code
    : undefined;
}

/** An HTTP status from `details.status`, `status` or `statusCode`. */
export function safeHttpStatus(error: unknown): number | undefined {
  for (const status of [
    read(read(error, "details"), "status"),
    read(error, "status"),
    read(error, "statusCode"),
  ]) {
    if (
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
    ) {
      return status;
    }
  }
  return undefined;
}

/** `details.operation` when it is a Composio tool slug Core calls. */
export function safeOperation(error: unknown): string | undefined {
  const operation = read(read(error, "details"), "operation");
  return typeof operation === "string" && KNOWN_OPERATIONS.has(operation)
    ? operation
    : undefined;
}

export function messageSafeErrorFields(error: unknown): SafeErrorFields {
  try {
    const code = safeErrorCode(error);
    const status = safeHttpStatus(error);
    const operation = safeOperation(error);
    return {
      errorName: safeErrorName(error),
      ...(code ? { code } : {}),
      ...(status ? { status } : {}),
      ...(operation ? { operation } : {}),
    };
  } catch {
    return { errorName: "Error" };
  }
}
