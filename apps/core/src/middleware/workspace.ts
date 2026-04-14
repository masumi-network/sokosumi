import { createMiddleware } from "hono/factory";
import prisma from "@/lib/db/prisma";
import { type EnvVariables } from "@/lib/hono";
import { type AuthVariables, isUserAuthContext } from "@/middleware/auth";

export interface WorkspaceContext {
  workspaceId: string;
  userId: string | null;
  organizationId: string | null;
}

export interface WorkspaceVariables {
  workspaceContext: WorkspaceContext | null;
}

export type AuthWithWorkspaceEnv = {
  Variables: AuthVariables & WorkspaceVariables;
};

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

    if (!isAuthenticated || !isUserAuthContext(authContext)) {
      c.set("workspaceContext", null);
      return await next();
    }

    const workspace = await prisma.workspace.findUnique({
      where: {
        ...(authContext.organizationId
          ? { organizationId: authContext.organizationId }
          : { userId: authContext.userId }),
      },
      select: {
        id: true,
        userId: true,
        organizationId: true,
      },
    });

    if (!workspace) {
      c.set("workspaceContext", null);
      return await next();
    }

    const workspaceContext: WorkspaceContext = {
      workspaceId: workspace.id,
      userId: workspace.userId,
      organizationId: workspace.organizationId,
    };

    c.set("workspaceContext", workspaceContext);
    return await next();
  });
