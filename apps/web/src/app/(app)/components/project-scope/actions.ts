"use server";

import { projectService } from "@/lib/services/project.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface LoadScopeProjectParams extends AuthenticatedRequest {
  projectId: string;
}

/**
 * Names the scoped project when it is on none of the switcher's lists, such as
 * a quiet project opened from a shared `?projectId` link.
 */
export const loadScopeProject = withSession<
  LoadScopeProjectParams,
  Awaited<ReturnType<typeof projectService.getProjectById>>
>(async ({ projectId }) => projectService.getProjectById(projectId));
