import { workspaceRepository } from "@sokosumi/database/repositories";
import { createMiddleware } from "hono/factory";
import { forbidden } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { captureExternalServiceError } from "@/lib/external-service-errors";
import type { EnvVariables } from "@/lib/hono";
import {
  type AuthenticationContext,
  isCoworkerAuthContext,
  isOrchestratorAuthContext,
  isUserAuthContext,
} from "@/middleware/auth";

export interface WorkspaceContext {
  workspaceId: string;
  userId: string | null;
  organizationId: string | null;
}

export interface WorkspaceVariables {
  workspaceContext: WorkspaceContext | null;
}

export function requireWorkspaceContext(
  workspaceContext: WorkspaceContext | null,
): WorkspaceContext {
  if (!workspaceContext) {
    throw forbidden("Workspace is missing");
  }
  return workspaceContext;
}

function getWorkspaceOwnerContext(authContext: AuthenticationContext): {
  userId: string;
  organizationId: string | null;
} | null {
  if (isUserAuthContext(authContext)) {
    return {
      userId: authContext.userId,
      organizationId: authContext.organizationId ?? null,
    };
  }

  if (isCoworkerAuthContext(authContext) && authContext.context) {
    return {
      userId: authContext.context.userId,
      organizationId: authContext.context.organizationId ?? null,
    };
  }

  if (isOrchestratorAuthContext(authContext) && authContext.context) {
    return {
      userId: authContext.context.userId,
      organizationId: authContext.context.organizationId ?? null,
    };
  }

  return null;
}

/**
 * Resolves the active workspace for authenticated user requests.
 *
 * This middleware is intentionally user-only. Coworker requests keep
 * `workspaceContext` as `null` and continue to use `authContext` directly.
 */
export const workspaceMiddleware = (includeWorkspaceContext: boolean) =>
  createMiddleware<EnvVariables>(async (c, next) => {
    if (!includeWorkspaceContext) {
      c.set("workspaceContext", null);
      return await next();
    }

    const { authContext, isAuthenticated } = c.var;

    if (!isAuthenticated) {
      c.set("workspaceContext", null);
      return await next();
    }

    const workspaceOwnerContext = getWorkspaceOwnerContext(authContext);
    if (!workspaceOwnerContext) {
      c.set("workspaceContext", null);
      return await next();
    }

    try {
      const workspace = await prisma.$transaction((tx) =>
        workspaceRepository.upsertWorkspaceForContext(
          workspaceOwnerContext.userId,
          workspaceOwnerContext.organizationId,
          tx,
        ),
      );

      const workspaceContext: WorkspaceContext = {
        workspaceId: workspace.id,
        userId: workspace.userId,
        organizationId: workspace.organizationId,
      };

      c.set("workspaceContext", workspaceContext);
    } catch (error) {
      captureExternalServiceError(error, {
        label: "workspace_context_resolution",
        sentry: {
          tags: {
            context: "workspace_context_resolution",
          },
          extra: {
            activeOrganizationId: workspaceOwnerContext.organizationId,
            userId: workspaceOwnerContext.userId,
          },
        },
      });
      c.set("workspaceContext", null);
    }

    return await next();
  });
