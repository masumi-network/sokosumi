import type { AuthenticationContext } from "@/middleware/auth";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  requireWorkspaceContext,
  type WorkspaceContext,
} from "@/middleware/workspace";
import type { SeoActor, SeoOwner } from "@/schemas/project-seo.schema";

/** External Coworker context never grants access to project research or private analytics. */
export function requireSeoRouteActor(
  vars: {
    authContext: AuthenticationContext;
    workspaceContext: WorkspaceContext | null;
  },
  owner: string | SeoOwner,
): SeoActor {
  return {
    ...requireSeoWorkspaceRouteActor(vars),
    owner: typeof owner === "string" ? { kind: "project", id: owner } : owner,
  };
}

export function requireSeoWorkspaceRouteActor(vars: {
  authContext: AuthenticationContext;
  workspaceContext: WorkspaceContext | null;
}) {
  const user = requireUserAuthContext(vars.authContext);
  const workspace = requireWorkspaceContext(vars.workspaceContext);
  return {
    workspaceId: workspace.workspaceId,
    userId: user.userId,
    organizationId: workspace.organizationId,
  };
}
