"use server";

import { projectService } from "@/lib/services/project.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

import { PROJECTS_PAGE_LIMIT } from "./constants";

interface LoadMoreProjectsParams extends AuthenticatedRequest {
  cursor: string | null;
  expectedScope?: { userId: string; organizationId: string | null };
}

export const loadMoreProjects = withSession<
  LoadMoreProjectsParams,
  {
    projects: Awaited<
      ReturnType<typeof projectService.listProjects>
    >["projects"];
    nextCursor: string | null;
  }
>(async ({ cursor, expectedScope, session }) => {
  if (
    expectedScope &&
    (expectedScope.userId !== session.user.id ||
      expectedScope.organizationId !==
        (session.session.activeOrganizationId ?? null))
  ) {
    throw new Error("Project workspace changed");
  }
  const page = await projectService.listProjects({
    cursor,
    limit: PROJECTS_PAGE_LIMIT,
  });

  return {
    projects: page.projects,
    nextCursor: page.pagination?.nextCursor ?? null,
  };
});
