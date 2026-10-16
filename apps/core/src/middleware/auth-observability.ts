import * as Sentry from "@sentry/node";
import { attachAuthToLogger } from "@/lib/evlog";

import type { AuthVariables } from "./auth";

/**
 * Mirrors the request's auth context into the Sentry scope and the request
 * logger. Reads `actor` directly so this module needs no runtime import from
 * `./auth`, which calls it.
 */
export function syncAuthObservers(context: AuthVariables) {
  syncSentryUser(context);
  syncRequestLogger(context);
}

function syncSentryUser(context: AuthVariables) {
  const scope = Sentry.getCurrentScope();

  if (!context.isAuthenticated) {
    scope.setUser(null);
    return;
  }

  const { authContext } = context;

  if (authContext.actor === "user") {
    scope.setUser({
      id: authContext.userId,
      organizationId: authContext.organizationId || undefined,
    });
    if (authContext.impersonatedBy) {
      scope.setContext("impersonation", {
        by: authContext.impersonatedBy,
        target: authContext.userId,
      });
    }
    return;
  }

  if (authContext.actor === "sokoBot") {
    scope.setUser({
      id: `sokoBot:${authContext.sokoBotId}`,
      sokoBotId: authContext.sokoBotId,
    });
    scope.setContext("sokoBotContext", {
      scope: authContext.scope,
      userId: authContext.userId,
      organizationId: authContext.organizationId,
      workspaceId: authContext.workspaceId,
    });
    return;
  }

  scope.setUser({
    id: `coworker:${authContext.coworkerId}`,
    coworkerId: authContext.coworkerId,
  });
  if (authContext.context) {
    scope.setContext("coworkerContext", {
      userId: authContext.context.userId,
      organizationId: authContext.context.organizationId,
    });
  }
}

function syncRequestLogger(context: AuthVariables) {
  if (!context.isAuthenticated) {
    attachAuthToLogger({ actor: "anonymous" });
    return;
  }

  const { authContext } = context;

  switch (authContext.actor) {
    case "user":
      attachAuthToLogger({
        actor: "user",
        userId: authContext.userId,
        organizationId: authContext.organizationId,
        impersonatedBy: authContext.impersonatedBy,
      });
      return;
    case "coworker":
      attachAuthToLogger({
        actor: "coworker",
        coworkerId: authContext.coworkerId,
        contextUserId: authContext.context?.userId,
        contextOrganizationId: authContext.context?.organizationId,
      });
      return;
    case "sokoBot":
      attachAuthToLogger({
        actor: "sokoBot",
        sokoBotId: authContext.sokoBotId,
        contextUserId: authContext.userId ?? undefined,
        contextOrganizationId: authContext.organizationId,
      });
      return;
    default: {
      const _exhaustive: never = authContext;
      void _exhaustive;
    }
  }
}
