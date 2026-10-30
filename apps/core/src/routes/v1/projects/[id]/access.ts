import type { Context } from "hono";

import type { EnvVariables } from "@/lib/hono";
import {
  type ProjectAccess,
  requireProjectAccess,
} from "@/lib/image-studio/access";
import { requireWorkspaceContext } from "@/middleware/workspace";

/**
 * The Project in the request's Workspace, for a caller the handler already
 * authenticated: 404 unless it is there and the caller is still a member.
 */
export function requireWorkspaceProject(
  c: Context<EnvVariables>,
  projectId: string,
  userId: string,
): Promise<ProjectAccess> {
  const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
  return requireProjectAccess({ projectId, workspaceId, userId });
}
