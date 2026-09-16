import { waitUntil } from "@vercel/functions";
import type { DrainContext } from "evlog";
import { createLogger, initLogger } from "evlog";
import { evlog, useLogger } from "evlog/hono";
import { createSentryDrain } from "evlog/sentry";
import type { MiddlewareHandler } from "hono";
import type { RequestIdVariables } from "hono/request-id";

import { matchedRouteTemplate } from "./route-template.js";

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
  });
}

/** Standalone logger for non-HTTP work (mention dispatch). Uses the global drain. */
export function createCoreLogger(initialContext: Record<string, unknown> = {}) {
  return createLogger(initialContext, {
    waitUntil: process.env.VERCEL ? waitUntil : undefined,
  });
}

export function coreEvlogDrain() {
  return process.env.SENTRY_DSN ? createSentryDrain() : undefined;
}

export function coreEvlogMiddleware() {
  return evlog({
    exclude: [OPENAPI_SPEC_PATH],
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

export function tryUseLogger() {
  try {
    return useLogger();
  } catch {
    return null;
  }
}
