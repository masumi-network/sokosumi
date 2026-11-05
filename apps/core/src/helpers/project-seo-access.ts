import type { AuthenticationContext } from "@/middleware/auth";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  requireWorkspaceContext,
  type WorkspaceContext,
} from "@/middleware/workspace";
import type { SeoActor } from "@/schemas/project-seo.schema";

/** External Coworker context never grants access to project research or private analytics. */
export function requireSeoRouteActor(
  vars: {
    authContext: AuthenticationContext;
    workspaceContext: WorkspaceContext | null;
  },
  projectId: string,
): SeoActor {
  const user = requireUserAuthContext(vars.authContext);
  const workspace = requireWorkspaceContext(vars.workspaceContext);
  return {
    projectId,
    workspaceId: workspace.workspaceId,
    userId: user.userId,
    organizationId: workspace.organizationId,
  };
}
