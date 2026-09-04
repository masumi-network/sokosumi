import { waitUntil } from "@vercel/functions";
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
  sokoBotId?: string;
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
