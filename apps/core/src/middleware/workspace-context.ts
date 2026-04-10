import { findWorkspaceForContext } from "@sokosumi/database/helpers";
import { createMiddleware } from "hono/factory";

import prisma from "@/lib/db/prisma";
import { type AuthEnv, isUserAuthContext } from "@/middleware/auth";

export interface WorkspaceContext {
  workspaceId: string;
  userId: string | null;
  organizationId: string | null;
}

/**
 * Resolves the active workspace for authenticated user requests.
 *
 * This middleware is intentionally user-only. Coworker requests keep
 * `workspaceContext` as `null` and continue to use `authContext` directly.
 */
export const workspaceContextMiddleware = createMiddleware<AuthEnv>(
  async (c, next) => {
    const { authContext, isAuthenticated } = c.var;

    if (!isAuthenticated || !isUserAuthContext(authContext)) {
      c.set("workspaceContext", null);
      return await next();
    }

    const workspace = await findWorkspaceForContext(
      authContext.userId,
      authContext.organizationId,
      prisma,
    );

    const workspaceContext: WorkspaceContext | null = workspace
      ? {
          workspaceId: workspace.id,
          userId: workspace.userId,
          organizationId: workspace.organizationId,
        }
      : null;

    c.set("workspaceContext", workspaceContext);
    return await next();
  },
);
