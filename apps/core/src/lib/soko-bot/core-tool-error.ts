import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  formatZodErrorMessage,
  type HTTPExceptionMetadata,
  unprocessableEntity,
} from "@/helpers/error";
import { ACTION_CAPABILITIES } from "@/lib/soko-bot/action-receipts";
import {
  classifyCoreToolError,
  isUncertainToolOutcome,
  TypedToolError,
  type TypedToolErrorPayload,
} from "@/lib/soko-bot/tool-errors";
import {
  RECORDED_SAVES,
  SokoBotTaintedActionError,
  SokoBotToolNotOpenError,
  SokoBotToolTimeoutError,
} from "@/lib/soko-bot/turn-loop";
import {
  SokoBotFeatureOffError,
  SokoBotImageRefusedError,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeConflictError,
  SokoBotRuntimeValidationError,
} from "@/services/soko-bot-runtime.service";

const MAX_CAUSE_DEPTH = 6;

export function isMutatingSokoBotCapability(capability: string): boolean {
  return ACTION_CAPABILITIES.has(capability) || capability in RECORDED_SAVES;
}

function httpExceptionMetadata(
  error: HTTPException,
): HTTPExceptionMetadata | undefined {
  return typeof error.cause === "object" && error.cause !== null
    ? (error.cause as HTTPExceptionMetadata)
    : undefined;
}

function httpExceptionKind(error: HTTPException): string | undefined {
  const metadata = httpExceptionMetadata(error);
  if (typeof metadata?.kind === "string") return metadata.kind;
  const extensionKind = metadata?.extensions?.kind;
  return typeof extensionKind === "string" ? extensionKind : undefined;
}

function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && current !== null && current !== undefined;
    depth++
  ) {
    chain.push(current);
    // HTTPException stores HTTPExceptionMetadata in `cause`, not another Error.
    if (current instanceof HTTPException) break;
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

function messageOf(error: unknown): string {
  if (error instanceof z.ZodError) return formatZodErrorMessage(error);
  if (error instanceof Error) return error.message || "Tool failed";
  return "Tool failed";
}

function semanticErrorName(chain: readonly unknown[]): string | undefined {
  for (const node of chain) {
    if (node instanceof SokoBotFeatureOffError) return "SokoBotFeatureOffError";
    if (node instanceof SokoBotTaintedActionError)
      return "SokoBotTaintedActionError";
    if (node instanceof SokoBotToolNotOpenError)
      return "SokoBotToolNotOpenError";
    if (node instanceof SokoBotRuntimeAuthorizationError)
      return "SokoBotRuntimeAuthorizationError";
    if (node instanceof SokoBotRuntimeConflictError)
      return "SokoBotRuntimeConflictError";
    if (node instanceof SokoBotToolTimeoutError)
      return "SokoBotToolTimeoutError";
    if (node instanceof z.ZodError) return "ZodError";
  }
  for (const node of chain) {
    if (node instanceof SokoBotImageRefusedError)
      return "SokoBotImageRefusedError";
    if (node instanceof SokoBotRefusedUnsentError)
      return "SokoBotRefusedUnsentError";
    if (node instanceof SokoBotRuntimeValidationError)
      return "SokoBotRuntimeValidationError";
    if (node instanceof Error && node.name && node.name !== "Error")
      return node.name;
  }
  return undefined;
}

/** Classifies any error thrown while executing a Core tool into a typed recovery payload. */
export function classifyThrownToolError(
  error: unknown,
  capability: string,
): TypedToolErrorPayload {
  if (error instanceof TypedToolError) return error.payload;
  const chain = causeChain(error);
  const http = chain.find(
    (node): node is HTTPException => node instanceof HTTPException,
  );
  const refusedUnsent = chain.some(
    (node) => node instanceof SokoBotRefusedUnsentError,
  );
  const uncertain = isUncertainToolOutcome(error);
  const mutating = isMutatingSokoBotCapability(capability) && !refusedUnsent;
  return classifyCoreToolError({
    message: messageOf(error),
    status: http?.status,
    kind: http ? httpExceptionKind(http) : undefined,
    errorName: semanticErrorName(chain),
    uncertain,
    mutating,
  });
}

/** Wraps a thrown Core tool error into `TypedToolError` (idempotent). */
export function toTypedToolError(
  error: unknown,
  capability: string,
): TypedToolError {
  if (error instanceof TypedToolError) return error;
  return new TypedToolError(classifyThrownToolError(error, capability), {
    cause: error,
  });
}

/**
 * Converts a failed `/v1/soko-bot-runtime/turns/:turnId/tools/:capability`
 * call into an `HTTPException` carrying `extensions.toolError` while keeping
 * existing status codes, `SOKO_BOT_TURN_INACTIVE` aborts, and Sentry rules intact.
 */
export function toSandboxToolHttpException(
  error: unknown,
  capability: string,
): HTTPException {
  if (error instanceof HTTPException) {
    const kind = httpExceptionKind(error);
    if (kind === CORE_API_ERROR_KINDS.SOKO_BOT_TURN_INACTIVE) return error;
    const metadata = httpExceptionMetadata(error);
    const toolError = classifyThrownToolError(error, capability);
    const nextMetadata: HTTPExceptionMetadata = {
      ...metadata,
      extensions: {
        ...metadata?.extensions,
        toolError,
      },
    };
    return new HTTPException(error.status, {
      message: error.message,
      cause: nextMetadata,
    });
  }
  const toolError = classifyThrownToolError(error, capability);
  // A refused or failed tool is the model's to read, not a transport error.
  return unprocessableEntity(toolError.message, {
    ...(toolError.coreKind ? { kind: toolError.coreKind } : {}),
    extensions: { toolError },
  });
}
