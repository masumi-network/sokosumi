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
  redactDeep,
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
 * tests see what Sentry sees. evlog's default built-ins mask emails, JWTs,
 * bearer tokens, and values under keys ending in password, secret or token;
 * env secrets by value are added here, as `beforeSend` does for Sentry events.
 *
 * `transform` runs first, on evlog's copy of the event. It turns the event
 * into bounded, acyclic JSON data, so evlog's own recursive built-ins and the
 * JSON output after them cannot overflow the stack on a cyclic or very deep
 * field: logging must not throw in place of the failure it reports.
 */
const CORE_REDACT: RedactConfig = {
  transform: (event) => {
    const safe = redactDeep(toLogData(event, 0, new Set()), getEnvSecrets());
    for (const key of Object.keys(event)) delete event[key];
    Object.assign(event, safe);
  },
};

const LOG_CIRCULAR = "[circular]";

/**
 * `value` as JSON would serialize it, cut at {@link MAX_REDACTION_DEPTH} and
 * at cycles: an unwalked subtree is replaced, never passed through. An Error
 * keeps its own fields (`code`, `cause`, …). `text`, when given, rewrites
 * every string on the way.
 */
export function toLogData(
  value: unknown,
  depth = 0,
  ancestors = new Set<object>(),
  text?: (value: string) => string,
): unknown {
  if (typeof value === "string") return text ? text(value) : value;
  if (typeof value === "bigint") return value.toString();
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
      if (json !== value) return toLogData(json, depth + 1, ancestors, text);
    }
    if (Array.isArray(value)) {
      return value.map(
        (item) => toLogData(item, depth + 1, ancestors, text) ?? null,
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
    for (const [key, item] of Object.entries(source)) {
      if (key === "toJSON") continue;
      const data = toLogData(item, depth + 1, ancestors, text);
      if (data !== undefined) out[key] = data;
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

/** Standalone logger for non-HTTP work (mention dispatch). Uses the global drain. */
export function createCoreLogger(initialContext: Record<string, unknown> = {}) {
  return createLogger(initialContext, {
    waitUntil: process.env.VERCEL ? waitUntil : undefined,
  });
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

const backgroundWork = new AsyncLocalStorage<true>();

/**
 * Runs `work` as known background work (a cron's sync): `recordCore*` inside
 * it emit standalone events. Such work starts in `waitUntil` before the
 * response, while the request's event is still live, and must not land on it.
 */
export function runAsBackgroundWork<T>(work: () => T): T {
  return backgroundWork.run(true, work);
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

export function recordCoreRequestError(error: Error) {
  tryUseLogger()?.error(error);
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
