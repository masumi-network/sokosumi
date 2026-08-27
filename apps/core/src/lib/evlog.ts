import type { DrainContext } from "evlog";
import { initLogger } from "evlog";
import { evlog, useLogger } from "evlog/hono";
import { createSentryDrain } from "evlog/sentry";
import type { MiddlewareHandler } from "hono";
import type { RequestIdVariables } from "hono/request-id";

const OPENAPI_SPEC_PATH = "/v1/openapi.json";

export interface InitCoreLoggerOptions {
  silent?: boolean;
  drain?: (ctx: DrainContext) => void | Promise<void>;
}

export function initCoreLogger(options: InitCoreLoggerOptions = {}) {
  initLogger({
    env: { service: "core" },
    silent: options.silent,
    drain: options.drain,
  });
}

export function coreEvlogMiddleware() {
  return evlog({
    exclude: [OPENAPI_SPEC_PATH],
    drain: process.env.SENTRY_DSN ? createSentryDrain() : undefined,
  });
}

export function bindCoreRequestId(): MiddlewareHandler<{
  Variables: RequestIdVariables;
}> {
  return async (c, next) => {
    tryUseLogger()?.set({ requestId: c.var.requestId });
    return await next();
  };
}

export interface CoreLogAuthIdentity {
  actor: "anonymous" | "user" | "coworker" | "orchestrator";
  userId?: string;
  organizationId?: string | null;
  coworkerId?: string;
  orchestratorId?: string;
  contextUserId?: string;
  contextOrganizationId?: string | null;
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

  if (identity.organizationId) {
    log.set({ organization: { id: identity.organizationId } });
  }

  if (identity.coworkerId) {
    log.set({ coworker: { id: identity.coworkerId } });
  }

  if (identity.orchestratorId) {
    log.set({ orchestrator: { id: identity.orchestratorId } });
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

export function recordCoreRequestError(error: Error) {
  tryUseLogger()?.error(error);
}

function tryUseLogger() {
  try {
    return useLogger();
  } catch {
    return null;
  }
}
