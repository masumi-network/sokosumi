import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
// Relative: the sandbox runner bundle (`soko-bot-runner.mjs`) has no `@/` alias.
import { isMutatingOrPaidToolCall } from "./tool-effects";

/**
 * General tool-error classes Core hands the model behind `typedToolErrors`.
 * Kept free of Hono/Prisma imports so both Core and the standalone sandbox
 * runner bundle (`soko-bot-runner.mjs`) share one source of truth.
 */
export const TOOL_ERROR_CLASSES = [
  "conflict",
  "busy",
  "not_found",
  "forbidden",
  "invalid_input",
  "transient",
  "uncertain",
] as const;

export type ToolErrorClass = (typeof TOOL_ERROR_CLASSES)[number];

export interface ToolErrorRecoveryRule {
  readonly retryable: boolean;
  readonly hint: string;
}

export interface TypedToolErrorPayload {
  kind: ToolErrorClass;
  retryable: boolean;
  hint: string;
  /** Raw Core API error kind (e.g. `image_studio_project_busy`), when present. */
  coreKind?: string;
  /** HTTP status Core answered, when present. */
  status?: number;
  /** Human-readable error message from Core or the tool. */
  message: string;
}

/**
 * General recovery rules, one per failure class. Safe for any request: never
 * suggests blindly reusing an unrelated item or repeating an unconfirmed write.
 */
export const TOOL_ERROR_RECOVERY_RULES: Readonly<
  Record<ToolErrorClass, ToolErrorRecoveryRule>
> = {
  conflict: {
    retryable: true,
    hint: "An item with that identifier already exists or its state or revision changed. Read the existing item first: reuse or update it with its current revision only if it already matches this request, otherwise pick a distinct name or identifier. If its current state blocks the change, stop and tell the owner.",
  },
  busy: {
    retryable: true,
    hint: "In-progress work is currently blocking this call. Check what is running and wait for it to finish (use wait_for when you have a running job or task to wait on) before retrying once; if you cannot wait for it, stop and tell the owner.",
  },
  not_found: {
    retryable: true,
    hint: "The referenced item was not found. List or search for the exact current identifier before retrying; if it does not exist, stop and tell the owner.",
  },
  forbidden: {
    retryable: false,
    hint: "This action is not permitted or cannot proceed as configured. Do not retry the same call; continue any other independent steps if possible, and tell the owner what permission, approval, setup, or choice is needed.",
  },
  invalid_input: {
    retryable: true,
    hint: "One or more arguments were invalid or rejected. Fix the specific field or constraint named in the error before retrying once; do not repeat the same arguments unchanged, and if required details are missing, ask the owner.",
  },
  transient: {
    retryable: true,
    hint: "This appears to be a temporary failure. Retry the call at most once; if it fails again, stop retrying and report the error to the owner.",
  },
  uncertain: {
    retryable: false,
    hint: "The outcome of this action or paid call could not be confirmed; it may already have taken effect or incurred spend. Do not repeat the call blindly: read back current state first to check whether it took effect, and if you still cannot tell, stop and report the uncertainty to the owner.",
  },
};

const TOOL_ERROR_CLASS_SET: ReadonlySet<string> = new Set(TOOL_ERROR_CLASSES);

const BUSY_CORE_KINDS: ReadonlySet<string> = new Set([
  "image_studio_project_busy",
  CORE_API_ERROR_KINDS.SEO_AUDIT_ACTIVE_CHECK,
  CORE_API_ERROR_KINDS.SEO_AUDIT_ACTIVE_CHAT,
]);

const TRANSIENT_CORE_KINDS: ReadonlySet<string> = new Set([
  // Serializable tx rolled back cleanly in Postgres: safe to retry once.
  CORE_API_ERROR_KINDS.CONCURRENCY_CONFLICT,
  CORE_API_ERROR_KINDS.SEO_GSC_UNAVAILABLE,
]);

const FORBIDDEN_CORE_KINDS: ReadonlySet<string> = new Set([
  "image_studio_rate_limited",
  CORE_API_ERROR_KINDS.AI_BUDGET_EXCEEDED,
  CORE_API_ERROR_KINDS.CALENDAR_CLIENT_UPGRADE_REQUIRED,
  CORE_API_ERROR_KINDS.CMO_CLIENT_REQUIRED,
  CORE_API_ERROR_KINDS.CMO_HIRE_NOT_ALLOWED,
  CORE_API_ERROR_KINDS.CMO_PROJECT_READ_ONLY,
  CORE_API_ERROR_KINDS.CMO_TEST_COPY_NOT_ALLOWED,
  CORE_API_ERROR_KINDS.CMO_TEST_COPY_OF_TEST_COPY,
  CORE_API_ERROR_KINDS.CMO_TEST_COPY_OTHER_ORGANIZATION,
  CORE_API_ERROR_KINDS.CMO_TEST_COPY_SOURCE_NOT_HIRED,
  CORE_API_ERROR_KINDS.COMPETITOR_LIMIT_REACHED,
  CORE_API_ERROR_KINDS.DRIVE_SHARE_IN_DATA_ROOM,
  CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE,
  CORE_API_ERROR_KINDS.INSUFFICIENT_SCOPE,
  CORE_API_ERROR_KINDS.INTEGRATION_NOT_CONFIGURED,
  CORE_API_ERROR_KINDS.LAST_WORKSPACE,
  CORE_API_ERROR_KINDS.NEWSLETTER_APPROVAL_REQUIRED,
  CORE_API_ERROR_KINDS.NEWSLETTER_NO_ACTIVE_SUBSCRIBERS,
  CORE_API_ERROR_KINDS.NEWSLETTER_SENDER_NOT_CONFIGURED,
  CORE_API_ERROR_KINDS.NO_PREFERRED_WORKSPACE,
  CORE_API_ERROR_KINDS.ORGANIZATION_LIMIT_REACHED,
  CORE_API_ERROR_KINDS.ORGANIZATION_MEMBERSHIP_REQUIRED,
  CORE_API_ERROR_KINDS.ORGANIZATION_ROLE_FORBIDDEN,
  CORE_API_ERROR_KINDS.ORGANIZATION_SEAT_REQUIRED,
  CORE_API_ERROR_KINDS.PERSON_APPROVAL_REQUIRED,
  CORE_API_ERROR_KINDS.PERSONAL_WORKSPACE_MISSING,
  CORE_API_ERROR_KINDS.SEAT_CAPACITY_EXCEEDED,
  CORE_API_ERROR_KINDS.SEO_GSC_NOT_CONNECTED,
  CORE_API_ERROR_KINDS.SEO_GSC_RECONNECT,
  CORE_API_ERROR_KINDS.SOCIAL_FACEBOOK_PAGE_REQUIRED,
  CORE_API_ERROR_KINDS.SOCIAL_YOUTUBE_CHANNEL_REQUIRED,
  CORE_API_ERROR_KINDS.SUBSCRIPTION_CHANGE_NOT_ALLOWED,
  CORE_API_ERROR_KINDS.SUBSCRIPTION_NOT_ACTIVE,
  CORE_API_ERROR_KINDS.SUBSCRIPTION_PAYMENT_FAILED,
  CORE_API_ERROR_KINDS.SUBSCRIPTION_SEATS_BELOW_ASSIGNED,
]);

const NOT_FOUND_CORE_KINDS: ReadonlySet<string> = new Set([
  CORE_API_ERROR_KINDS.INVOICE_NOT_FOUND,
  CORE_API_ERROR_KINDS.MEMBER_NOT_FOUND,
  CORE_API_ERROR_KINDS.ORGANIZATION_NOT_FOUND,
  CORE_API_ERROR_KINDS.PROJECT_DELETION_REMOVED,
]);

const INVALID_INPUT_CORE_KINDS: ReadonlySet<string> = new Set([
  CORE_API_ERROR_KINDS.CONTEXT_ORGANIZATION_REQUIRED,
  CORE_API_ERROR_KINDS.FREE_CREDIT_INVALID,
  CORE_API_ERROR_KINDS.INVOICE_INVALID,
  CORE_API_ERROR_KINDS.QUEUED_REQUIRES_RUN_AT,
  CORE_API_ERROR_KINDS.RUN_AT_NOT_IN_FUTURE,
  CORE_API_ERROR_KINDS.SCHEDULE_RUN_TARGET_INVALID,
  CORE_API_ERROR_KINDS.SEO_GSC_PROPERTY,
  CORE_API_ERROR_KINDS.SEO_GSC_RESPONSE_TOO_LARGE,
  CORE_API_ERROR_KINDS.STATUS_NOT_SELECTABLE,
]);

const CONFLICT_CORE_KINDS: ReadonlySet<string> = new Set([
  CORE_API_ERROR_KINDS.CHANNEL_SLUG_TAKEN,
  CORE_API_ERROR_KINDS.CMO_UNPAID_CUSO,
  CORE_API_ERROR_KINDS.COMPETITOR_NAME_TAKEN,
  CORE_API_ERROR_KINDS.COMPETITOR_REMOVAL_STALE,
  CORE_API_ERROR_KINDS.CONTACT_CHANNEL_TAKEN,
  CORE_API_ERROR_KINDS.CONTACT_VERSION_CONFLICT,
  CORE_API_ERROR_KINDS.PROJECT_IDENTIFIER_TAKEN,
  CORE_API_ERROR_KINDS.SCHEDULE_OPERATION_CONFLICT,
  CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT,
  CORE_API_ERROR_KINDS.SCHEDULE_RUN_STATE_CONFLICT,
  CORE_API_ERROR_KINDS.SCHEDULE_STATE_CONFLICT,
  CORE_API_ERROR_KINDS.SEO_AUDIT_RESUMABLE_MONITOR,
  CORE_API_ERROR_KINDS.SEO_AUDIT_TASK_SCOPE_CONFLICT,
  CORE_API_ERROR_KINDS.SOCIAL_POST_REVISION_CONFLICT,
  CORE_API_ERROR_KINDS.TASK_SCHEDULE_MOVED,
  CORE_API_ERROR_KINDS.TASK_WORKSPACE_TAGS_CHANGED,
  CORE_API_ERROR_KINDS.WORKSPACE_HAS_DEPENDENTS,
]);

const FORBIDDEN_ERROR_NAMES: ReadonlySet<string> = new Set([
  "SokoBotRuntimeAuthorizationError",
  "SokoBotTaintedActionError",
  "SokoBotFeatureOffError",
  "SokoBotToolNotOpenError",
]);

const INVALID_INPUT_ERROR_NAMES: ReadonlySet<string> = new Set([
  "ZodError",
  "AI_InvalidToolInputError",
  "AI_NoSuchToolError",
  "SokoBotRuntimeValidationError",
  "SokoBotRefusedUnsentError",
  "SokoBotImageRefusedError",
]);

const CONFLICT_ERROR_NAMES: ReadonlySet<string> = new Set([
  "SokoBotRuntimeConflictError",
  "MonthPostsChangedError",
]);

const TRANSIENT_ERROR_NAMES: ReadonlySet<string> = new Set([
  "TimeoutError",
  "AbortError",
  "HeadersTimeoutError",
  "ConnectTimeoutError",
  "BodyTimeoutError",
  "SokoBotToolTimeoutError",
  "ExaUnavailableError",
  "EditTimedOutError",
]);

const UNCERTAIN_OUTCOME_ERRORS = new WeakSet<object>();

/** Marks a thrown error whose Core receipt recorded disposition UNKNOWN. */
export function markUncertainToolOutcome<T>(error: T): T {
  if (typeof error === "object" && error !== null) {
    UNCERTAIN_OUTCOME_ERRORS.add(error);
  }
  return error;
}

/** True when this error or any cause in its chain left an unconfirmed write. */
export function isUncertainToolOutcome(error: unknown): boolean {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 6 && current !== null && current !== undefined;
    depth++
  ) {
    if (typeof current === "object" && UNCERTAIN_OUTCOME_ERRORS.has(current)) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

export interface ClassifyCoreToolErrorInput {
  message: string;
  status?: number;
  kind?: string;
  errorName?: string;
  /** True when Core recorded UNKNOWN or could not verify whether a write committed. */
  uncertain?: boolean;
  /**
   * True when the tool mutates state and the failure was NOT proven pre-dispatch.
   * Prevents unknown/5xx/timeout write failures from being classified as `transient`.
   */
  mutating?: boolean;
}

function classifyByCoreKind(
  coreKind: string,
  mutating: boolean,
): ToolErrorClass | null {
  if (BUSY_CORE_KINDS.has(coreKind)) return "busy";
  if (TRANSIENT_CORE_KINDS.has(coreKind)) return "transient";
  if (FORBIDDEN_CORE_KINDS.has(coreKind)) return "forbidden";
  if (NOT_FOUND_CORE_KINDS.has(coreKind)) return "not_found";
  if (INVALID_INPUT_CORE_KINDS.has(coreKind)) return "invalid_input";
  if (CONFLICT_CORE_KINDS.has(coreKind)) return "conflict";
  if (coreKind.endsWith("_not_found")) return "not_found";
  if (coreKind.endsWith("_busy")) return "busy";
  if (coreKind.endsWith("_forbidden")) return "forbidden";
  if (coreKind.endsWith("_conflict") || coreKind.endsWith("_taken"))
    return "conflict";
  if (coreKind.endsWith("_unavailable"))
    return mutating ? "uncertain" : "transient";
  return null;
}

function classifyByStatus(
  status: number,
  mutating: boolean,
): ToolErrorClass | null {
  if (status === 409) return "conflict";
  if (status === 429) return "busy";
  if (status === 404 || status === 410) return "not_found";
  if (status === 401 || status === 402 || status === 403) return "forbidden";
  if (status === 400 || status === 413 || status === 422)
    return "invalid_input";
  if (status === 408 || status >= 500)
    return mutating ? "uncertain" : "transient";
  return null;
}

function classifyConflictErrorMessage(message: string): ToolErrorClass {
  if (/reconcil|outcome is unknown|cannot be verified/i.test(message))
    return "uncertain";
  if (/already executing|claimed concurrently/i.test(message)) return "busy";
  if (/tool-call limit reached/i.test(message)) return "forbidden";
  return "conflict";
}

function resolveToolErrorClass(
  input: ClassifyCoreToolErrorInput,
): ToolErrorClass {
  if (input.uncertain) return "uncertain";
  const mutating = input.mutating === true;
  if (input.kind) {
    const fromKind = classifyByCoreKind(input.kind, mutating);
    if (fromKind) return fromKind;
  }
  if (input.status !== undefined) {
    const fromStatus = classifyByStatus(input.status, mutating);
    if (fromStatus) return fromStatus;
  }
  if (input.errorName) {
    if (FORBIDDEN_ERROR_NAMES.has(input.errorName)) return "forbidden";
    if (CONFLICT_ERROR_NAMES.has(input.errorName))
      return classifyConflictErrorMessage(input.message);
    if (INVALID_INPUT_ERROR_NAMES.has(input.errorName)) return "invalid_input";
    if (TRANSIENT_ERROR_NAMES.has(input.errorName))
      return mutating ? "uncertain" : "transient";
  }
  return mutating ? "uncertain" : "transient";
}

/** Maps Core error metadata to a general failure class and safe recovery rule. */
export function classifyCoreToolError(
  input: ClassifyCoreToolErrorInput,
): TypedToolErrorPayload {
  const kind = resolveToolErrorClass(input);
  const rule = TOOL_ERROR_RECOVERY_RULES[kind];
  return {
    kind,
    retryable: rule.retryable,
    hint: rule.hint,
    ...(input.kind ? { coreKind: input.kind } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    message: input.message || "Tool failed",
  };
}

/** Validates a serialized `toolError` object received over HTTP from Core. */
export function isTypedToolErrorPayload(
  value: unknown,
): value is TypedToolErrorPayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.kind === "string" &&
    TOOL_ERROR_CLASS_SET.has(record.kind) &&
    typeof record.retryable === "boolean" &&
    typeof record.hint === "string" &&
    record.hint.length > 0 &&
    typeof record.message === "string" &&
    (record.coreKind === undefined || typeof record.coreKind === "string") &&
    (record.status === undefined || typeof record.status === "number")
  );
}

/** Compact typed JSON stored in the tool-result error message itself. */
export function formatTypedToolErrorText(
  payload: TypedToolErrorPayload,
): string {
  return JSON.stringify({
    kind: payload.kind,
    retryable: payload.retryable,
    ...(payload.status !== undefined ? { status: payload.status } : {}),
    ...(payload.coreKind ? { coreKind: payload.coreKind } : {}),
    message: payload.message,
  });
}

/** Error thrown by tool execution when `typedToolErrors` is enabled on the version. */
export class TypedToolError extends Error {
  readonly payload: TypedToolErrorPayload;

  constructor(payload: TypedToolErrorPayload, options?: ErrorOptions) {
    super(formatTypedToolErrorText(payload), options);
    this.name = "TypedToolError";
    this.payload = payload;
  }
}

/**
 * Error returned when the sandbox runner's POST to Core is rejected.
 * Keeps HTTP `status`, Core `kind`, and Core's classified `toolError` payload.
 */
export class CoreRejected extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind?: string,
    readonly toolError?: TypedToolErrorPayload,
  ) {
    super(message);
  }
}

/**
 * Converts a sandbox runner tool failure into a `TypedToolError` without
 * dropping `CoreRejected.status`, `CoreRejected.kind`, or Core's classified payload.
 * Uses the same input-aware effect classification as Core so lost responses on
 * writes or paid calls classify as `uncertain` (`retryable: false`).
 */
export function classifyRunnerToolError(
  error: unknown,
  capability: string,
  toolInput?: unknown,
): TypedToolError {
  if (error instanceof TypedToolError) return error;
  const mutating = isMutatingOrPaidToolCall(capability, toolInput);
  if (error instanceof CoreRejected) {
    const payload =
      error.toolError ??
      classifyCoreToolError({
        message: error.message,
        status: error.status,
        kind: error.kind,
        mutating,
      });
    return new TypedToolError(payload, { cause: error });
  }
  const message = error instanceof Error ? error.message : "Tool failed";
  const errorName = error instanceof Error ? error.name : undefined;
  return new TypedToolError(
    classifyCoreToolError({ message, errorName, mutating }),
    { cause: error },
  );
}

export interface ToolErrorRecoveryEntry {
  toolName: string;
  payload: TypedToolErrorPayload;
}

/**
 * Formats one fresh user-side recovery note for every failed tool in the
 * immediately preceding step. Delivered outside the tool message so the model
 * diagnoses the failure class before choosing its next move.
 */
export function formatToolErrorRecoveryNote(
  entries: readonly ToolErrorRecoveryEntry[],
): string {
  const lines = entries.map(({ toolName, payload }) => {
    const typed = JSON.stringify({
      kind: payload.kind,
      retryable: payload.retryable,
      hint: payload.hint,
    });
    return `- ${toolName}: ${typed}`;
  });
  return [
    "Tool error recovery note (from Core, not the owner):",
    ...lines,
    "Follow the hint for each failed tool before your next action.",
  ].join("\n");
}
