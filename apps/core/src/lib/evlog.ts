import { AsyncLocalStorage } from "node:async_hooks";
import { waitUntil } from "@vercel/functions";
import type {
  DrainContext,
  ErrorOptions,
  EvlogPlugin,
  RedactConfig,
  RequestLogger,
} from "evlog";
import { createError, createLogger, initLogger } from "evlog";
import { evlog, useLogger } from "evlog/hono";
import { createSentryDrain } from "evlog/sentry";
import type { MiddlewareHandler } from "hono";
import type { RequestIdVariables } from "hono/request-id";

import { matchedRouteTemplate } from "./route-template.js";
import {
  getEnvSecrets,
  MAX_REDACTION_DEPTH,
  REDACTED_TOO_DEEP,
  redactSecrets,
} from "./secret-redaction.js";

const OPENAPI_SPEC_PATH = "/v1/openapi.json";

export interface InitCoreLoggerOptions {
  silent?: boolean;
  drain?: (ctx: DrainContext) => void | Promise<void>;
}

export function initCoreLogger(options: InitCoreLoggerOptions = {}) {
  initLogger({
    env: { service: "core" },
    silent: options.silent,
    drain: options.drain ?? coreEvlogDrain(),
    redact: CORE_REDACT,
  });
}

/**
 * Redaction before console output and every drain, in every environment, so
 * tests see what Sentry sees. Values under keys ending in password, passwd,
 * secret or token are replaced by evlog's `secrets` built-in; env secrets are
 * masked by value, as `beforeSend` does for Sentry events.
 *
 * `transform` runs first, on evlog's copy of the event. It turns the event
 * into bounded, acyclic JSON data, so evlog's own recursive built-ins and the
 * JSON output after them cannot overflow the stack on a cyclic or very deep
 * field: logging must not throw in place of the failure it reports.
 *
 * It also runs evlog's value maskers itself, because evlog's `iban`,
 * `creditCard` and `phone` match digit runs inside UUIDs
 * (`01960001-0001-7001-8001-000000000001` drained as `****7001-****0001`), and
 * evlog 2.35.1 has no hook to exempt a match. The policy: a UUID stays whole
 * only in the value of an id field ({@link ID_KEY}, arrays and composites such
 * as `task_<uuid>` included) and only when RFC 9562-valid; everywhere else,
 * messages, `why` and `fix` included, every masker runs, so a card number in
 * UUID shape is still masked. Even in an id field the exemption covers only
 * the UUID-damaging maskers, and only a match that lies inside the UUID: the
 * others see the whole value, so `Bearer <uuid>` or `alice+<uuid>@example.com`
 * is still masked, and a match that crosses the UUID's edge is masked.
 * Accepted trade-off: an RFC-valid UUID whose digits also form a card number
 * (`41111111-1111-4115-8111-111111111111`) stays whole in an id field, so an
 * id field must never carry anything but an ID. Put IDs in id-named fields.
 * Upstream ask:
 * ~/notes/core-logging/evlog-uuid-upstream-issue.md. A built-in evlog adds
 * later is off until copied here.
 */
const CORE_REDACT: RedactConfig = {
  builtins: ["secrets"],
  transform: (event) => {
    const secrets = getEnvSecrets();
    const safe = toLogData(event, 0, new Set(), (text, key) =>
      maskPii(
        redactSecrets(text, secrets),
        key !== undefined && ID_KEY.test(key),
      ),
    );
    for (const key of Object.keys(event)) delete event[key];
    Object.assign(event, safe);
  },
};

/** `id`, `taskId`, `taskIds`, `workspace_id`. */
const ID_KEY = /^id$|Ids?$|_id$/;

/** An RFC 9562 UUID: version nibble 1-8, variant nibble 8, 9, a or b. */
const RFC_UUID =
  /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![0-9a-f])/gi;

/**
 * evlog 2.35.1's default value built-ins, copied in its order. `true` marks
 * the ones that match digit runs inside UUIDs.
 */
const PII_MASKERS: [RegExp, (match: string) => string, boolean?][] = [
  [/\bBearer\s+[\w\-.~+/]{8,}=*/gi, () => "Bearer ***"],
  [
    /\b[A-Z]{2}\d{2}[\s-]?[\dA-Z]{4}[\s-]?[\dA-Z]{4}[\s-]?[\dA-Z]{4}[\s-]?[\dA-Z]{0,4}[\s-]?[\dA-Z]{0,4}[\s-]?[\dA-Z]{0,4}\b/g,
    (match) => {
      const clean = match.replace(/[\s-]/g, "");
      return `${clean.slice(0, 4)}****${clean.slice(-3)}`;
    },
    true,
  ],
  [
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    (match) => `****${match.replace(/[\s-]/g, "").slice(-4)}`,
    true,
  ],
  [
    /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63})*\.[a-zA-Z]{2,63}\b/g,
    (match) =>
      match.indexOf("@") < 1
        ? "***@***"
        : `${match[0]}***@***${match.slice(match.lastIndexOf("."))}`,
  ],
  [
    /\b(?!0\.0\.0\.0\b)(?!127\.0\.0\.1\b)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    (match) => `***.***.***.${match.split(".").pop()}`,
  ],
  [
    /(?:\+\d{1,3}[\s.-]?\(?\d{1,4}\)?|\(\d{1,4}\))(?:[\s.-]?\d{2,4}){2,4}\b/g,
    (match) => {
      const digits = match.replace(/[^\d]/g, "");
      if (match.startsWith("+") && digits.length > 4) {
        return `${match.match(/^\+\d{1,3}/)?.[0] ?? "+"}******${digits.slice(-2)}`;
      }
      if (digits.length > 2) {
        return `${"*".repeat(digits.length - 2)}${digits.slice(-2)}`;
      }
      return "***";
    },
    true,
  ],
  [/\beyJ(?:(?!-eyJ)[\w-])*\.[\w-]*\.[\w-]*\b/g, () => "eyJ***.***"],
];

/**
 * `text` with every masker applied in order. With `keepUuids`, a UUID-damaging
 * masker skips a match that lies inside one of the RFC UUIDs in the text.
 */
function maskPii(text: string, keepUuids: boolean): string {
  return PII_MASKERS.reduce((masked, [pattern, mask, damagesUuids]) => {
    if (!keepUuids || !damagesUuids) return masked.replace(pattern, mask);
    const uuids = Array.from(masked.matchAll(RFC_UUID), (uuid) => [
      uuid.index,
      uuid.index + uuid[0].length,
    ]);
    // Matches and UUID spans both come in order: one forward cursor keeps
    // this linear in the number of UUIDs.
    let next = 0;
    return masked.replace(pattern, (match: string, offset: number) => {
      while (next < uuids.length && uuids[next][1] <= offset) next += 1;
      const uuid = uuids[next];
      const inside =
        uuid !== undefined &&
        uuid[0] <= offset &&
        offset + match.length <= uuid[1];
      return inside ? match : mask(match);
    });
  }, text);
}

const LOG_CIRCULAR = "[circular]";

/**
 * `value` as JSON would serialize it, cut at {@link MAX_REDACTION_DEPTH} and
 * at cycles: an unwalked subtree is replaced, never passed through. An Error
 * keeps its own fields (`code`, `cause`, …). `text`, when given, rewrites
 * every string on the way; `key` is the field it sits under, an array's for
 * its items.
 */
export function toLogData(
  value: unknown,
  depth = 0,
  ancestors = new Set<object>(),
  text?: (value: string, key: string | undefined) => string,
  key?: string,
): unknown {
  if (typeof value === "string") return text ? text(value, key) : value;
  if (typeof value === "bigint") {
    return text ? text(value.toString(), key) : value.toString();
  }
  if (value === null || typeof value !== "object") {
    return typeof value === "function" || typeof value === "symbol"
      ? undefined
      : value;
  }
  if (ancestors.has(value)) return LOG_CIRCULAR;
  if (depth >= MAX_REDACTION_DEPTH) return REDACTED_TOO_DEEP;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return `[binary ${value.byteLength} bytes]`;
  }

  ancestors.add(value);
  try {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") {
      let json: unknown;
      try {
        json = toJSON.call(value);
      } catch {
        return "[unserializable]";
      }
      if (json !== value) {
        return toLogData(json, depth + 1, ancestors, text, key);
      }
    }
    if (Array.isArray(value)) {
      return value.map(
        (item) => toLogData(item, depth + 1, ancestors, text, key) ?? null,
      );
    }
    const source: Record<string, unknown> =
      value instanceof Error
        ? {
            ...value,
            name: value.name,
            message: value.message,
            stack: value.stack,
            cause: value.cause,
          }
        : (value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [field, item] of Object.entries(source)) {
      if (field === "toJSON") continue;
      const data = toLogData(item, depth + 1, ancestors, text, field);
      if (data !== undefined) out[field] = data;
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}

/** What a Core warning says: what happened, why, and what to do. */
export interface CoreWarning {
  message: string;
  /** A fixed sentence Core writes, never a provider's or library's error text. */
  why?: string;
  fix?: string;
  link?: string;
  /**
   * The error behind the warning; its text goes here, not into `why`.
   * Redaction runs on it before the drain.
   */
  cause?: unknown;
}

/**
 * Records `warning` on `log`'s event, under `warnings`, so each warning keeps
 * its `why` and `fix` next to the others on the same event. Errors go through
 * `log.error(createError({ message, why, fix, link }))` instead.
 *
 * `requestLogIndex` names the `requestLogs` line this warning adds, so its
 * guidance stays with that line even when another warning shares the text.
 */
export function logCoreWarning(
  log: Pick<RequestLogger, "warn" | "getContext">,
  warning: CoreWarning,
  fields: Record<string, unknown> = {},
) {
  const { requestLogs } = log.getContext();
  const requestLogIndex = Array.isArray(requestLogs) ? requestLogs.length : 0;
  const { cause, ...guidance } = warning;
  log.warn(warning.message, {
    ...fields,
    // The cause stays with its own warning when several share an event.
    warnings: [
      {
        ...guidance,
        ...(cause === undefined ? {} : { cause: errorCause(cause) }),
        requestLogIndex,
      },
    ],
  });
}

/** Fields every standalone event started inside the background work carries. */
export interface BackgroundWorkContext {
  /** The cron run the work belongs to, set by `handleSyncRequest`. */
  syncRunId?: string;
}

const backgroundWork = new AsyncLocalStorage<BackgroundWorkContext>();

/**
 * Runs `work` as known background work (a cron's sync): `recordCore*` inside
 * it emit standalone events. Such work starts in `waitUntil` before the
 * response, while the request's event is still live, and must not land on it.
 * `context` goes on every standalone event started inside `work`, background
 * work it starts included; nested work keeps the outer context.
 */
export function runAsBackgroundWork<T>(
  work: () => T,
  context: BackgroundWorkContext = {},
): T {
  return backgroundWork.run({ ...backgroundWork.getStore(), ...context }, work);
}

/**
 * Standalone logger for non-HTTP work (mention dispatch). Uses the global
 * drain. Inside `runAsBackgroundWork` the event also carries its context.
 */
export function createCoreLogger(initialContext: Record<string, unknown> = {}) {
  return createLogger(
    { ...backgroundWork.getStore(), ...initialContext },
    {
      waitUntil: process.env.VERCEL ? waitUntil : undefined,
    },
  );
}

/**
 * One standalone event holding `warning`, for work after the response or in
 * the background, where the request's event is already emitted.
 */
export function emitCoreWarning(
  context: Record<string, unknown>,
  warning: CoreWarning,
  fields?: Record<string, unknown>,
) {
  const log = createCoreLogger(context);
  logCoreWarning(log, warning, fields);
  log.emit();
}

/**
 * What a Core error says. `why` is a fixed sentence Core writes; the
 * provider's or library's error text goes only into `cause`, which may be
 * anything a `catch` received.
 */
export interface CoreError extends Omit<ErrorOptions, "cause"> {
  cause?: unknown;
}

/** `cause` as an `Error`, so a rejected string keeps its text there too. */
function errorCause(cause: unknown): Error | undefined {
  if (cause instanceof Error) return cause;
  if (typeof cause === "string") return new Error(cause);
  return undefined;
}

/** The one writer behind `emitCoreError` and `recordCoreError`. */
function writeCoreError(
  log: Pick<RequestLogger, "error">,
  { cause, ...error }: CoreError,
  fields?: Record<string, unknown>,
) {
  log.error(createError({ ...error, cause: errorCause(cause) }), fields);
}

/**
 * One standalone error event, for work after the response or in the
 * background.
 */
export function emitCoreError(
  context: Record<string, unknown>,
  error: CoreError,
  fields?: Record<string, unknown>,
) {
  const log = createCoreLogger(context);
  writeCoreError(log, error, fields);
  log.emit();
}

/** `context` without `operation`, which names standalone work, not a request. */
function requestFields(
  { operation: _operation, ...context }: Record<string, unknown>,
  fields?: Record<string, unknown>,
) {
  return { ...context, ...fields };
}

/**
 * For code that runs both inside a request and after one: `warning` on the
 * request's event while it is live, else its own standalone event.
 */
export function recordCoreWarning(
  context: Record<string, unknown>,
  warning: CoreWarning,
  fields?: Record<string, unknown>,
) {
  const log = tryUseLiveLogger();
  if (!log) return emitCoreWarning(context, warning, fields);
  logCoreWarning(log, warning, requestFields(context, fields));
}

/**
 * For code that runs both inside a request and after one: `error` on the
 * request's event while it is live, else its own standalone event.
 */
export function recordCoreError(
  context: Record<string, unknown>,
  error: CoreError,
  fields?: Record<string, unknown>,
) {
  const log = tryUseLiveLogger();
  if (!log) return emitCoreError(context, error, fields);
  writeCoreError(log, error, requestFields(context, fields));
}

export function coreEvlogDrain() {
  return process.env.SENTRY_DSN ? createSentryDrain() : undefined;
}

/** Request loggers whose wide event has been emitted; writes to them are dropped. */
const emittedRequestLoggers = new WeakSet<RequestLogger>();

/**
 * Marks each request logger as it emits. evlog 2.35.1 exposes no emitted
 * state, and work after the response keeps the request's async context, so
 * `useLogger()` still hands that logger out.
 */
const markEmittedRequestLoggers: EvlogPlugin = {
  name: "core-emitted-request-loggers",
  extendLogger(logger) {
    const emit = logger.emit;
    logger.emit = (overrides) => {
      emittedRequestLoggers.add(logger);
      return emit(overrides);
    };
  },
};

export function coreEvlogMiddleware() {
  return evlog({
    exclude: [OPENAPI_SPEC_PATH],
    plugins: [markEmittedRequestLoggers],
    drain: coreEvlogDrain(),
    // Local/tests must not pass waitUntil: evlog then skips awaiting the
    // drain, and @vercel/functions waitUntil is a no-op off Vercel.
    waitUntil: process.env.VERCEL ? waitUntil : undefined,
  });
}

/**
 * Label the request event with the Core requestId and the matched route
 * template.
 *
 * evlog's hono adapter seeds the event with `c.req.path`, the concrete path.
 * Paths carry capability tokens (share links, invite links, password reset
 * links), and `createSentryDrain` sends `path` to Sentry as both the log body
 * and an attribute on every request, not only sampled ones. Overwriting `path`
 * here keeps the token out of the drain while the route stays queryable.
 */
export function bindCoreRequestContext(): MiddlewareHandler<{
  Variables: RequestIdVariables;
}> {
  return async (c, next) => {
    tryUseLogger()?.set({
      requestId: c.var.requestId,
      path: matchedRouteTemplate(c),
    });
    return await next();
  };
}

export interface CoreLogAuthIdentity {
  actor: "anonymous" | "user" | "coworker" | "sokoBot";
  userId?: string;
  organizationId?: string | null;
  coworkerId?: string;
  sokoBotId?: string;
  contextUserId?: string;
  contextOrganizationId?: string | null;
  /** Platform admin id when this request is an impersonated session. */
  impersonatedBy?: string;
}

export interface CoreLogWorkspaceIdentity {
  workspaceId: string;
  userId: string | null;
  organizationId: string | null;
}

export function attachAuthToLogger(identity: CoreLogAuthIdentity) {
  const log = tryUseLogger();
  if (!log) {
    return;
  }

  log.set({ actor: identity.actor });

  if (identity.userId) {
    log.set({ user: { id: identity.userId } });
  }

  if (identity.impersonatedBy) {
    log.set({
      impersonation: {
        by: identity.impersonatedBy,
        target: identity.userId,
      },
    });
  }

  if (identity.organizationId) {
    log.set({ organization: { id: identity.organizationId } });
  }

  if (identity.coworkerId) {
    log.set({ coworker: { id: identity.coworkerId } });
  }

  if (identity.sokoBotId) {
    log.set({ sokoBot: { id: identity.sokoBotId } });
  }

  if (identity.contextUserId) {
    log.set({
      context: {
        userId: identity.contextUserId,
        organizationId: identity.contextOrganizationId ?? null,
      },
    });
  }
}

export function attachWorkspaceToLogger(
  workspace: CoreLogWorkspaceIdentity | null,
) {
  if (!workspace) {
    return;
  }

  tryUseLogger()?.set({
    workspace: {
      id: workspace.workspaceId,
      userId: workspace.userId,
      organizationId: workspace.organizationId,
    },
  });
}

export interface CoreLogUpload {
  filename: string;
  size: number;
  mimeType: string;
}

export function attachUploadToLogger(file: CoreLogUpload) {
  tryUseLogger()?.set({
    upload: {
      filename: file.filename,
      size: file.size,
      mimeType: file.mimeType,
    },
  });
}

export interface ImpersonationAuditInput {
  /** Platform admin performing the impersonation. */
  adminId: string;
  /** Non-admin user being impersonated. */
  targetUserId: string;
  /** Start reason (Linear-id convention). Start only — stops carry none. */
  reason?: string;
}

function auditImpersonation(
  action: "impersonation.start" | "impersonation.stop",
  input: ImpersonationAuditInput,
) {
  tryUseLogger()?.audit({
    action,
    actor: { type: "user", id: input.adminId },
    target: { type: "user", id: input.targetUserId },
    ...(input.reason ? { reason: input.reason } : {}),
    outcome: "success",
  });
}

/** Audit trail for an impersonation start (actor, target, reason). */
export function auditImpersonationStart(
  input: ImpersonationAuditInput & { reason: string },
) {
  auditImpersonation("impersonation.start", input);
}

/** Audit trail for an impersonation stop (actor, target). */
export function auditImpersonationStop(input: ImpersonationAuditInput) {
  auditImpersonation("impersonation.stop", input);
}

export interface ImpersonationDenialInput {
  action: "impersonation.start" | "impersonation.stop";
  actorId: string;
  /**
   * evlog actor type. evlog has no coworker/sokoBot type, so agent callers
   * audit as `agent`. Defaults to `user`.
   */
  actorType?: "user" | "agent";
  targetUserId?: string;
  /** Why the attempt was rejected (policy message, not the Linear start reason). */
  denial: string;
}

/** Audit trail for a rejected impersonation start or stop. */
export function auditImpersonationDenied(input: ImpersonationDenialInput) {
  tryUseLogger()?.audit.deny(input.denial, {
    action: input.action,
    actor: { type: input.actorType ?? "user", id: input.actorId },
    ...(input.targetUserId
      ? { target: { type: "user", id: input.targetUserId } }
      : {}),
  });
}

/**
 * The request's logger while its wide event can still take writes: `null`
 * outside a request, after the event was emitted (work in `waitUntil`), and
 * inside `runAsBackgroundWork`, which may start before the emit.
 * For code that cannot know where it runs, such as library loggers, which
 * fall back to a standalone event. `tryUseLogger` keeps returning the emitted
 * logger, so evlog still warns about a late write that should have been a
 * standalone event.
 */
export function tryUseLiveLogger() {
  // Known background work never writes on the request that started it.
  if (backgroundWork.getStore()) return null;
  const log = tryUseLogger();
  return log && !emittedRequestLoggers.has(log) ? log : null;
}

export function tryUseLogger() {
  try {
    return useLogger();
  } catch {
    return null;
  }
}
