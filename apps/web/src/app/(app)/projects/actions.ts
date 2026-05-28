"use server";

import { projectService } from "@/lib/services/project.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

import { PROJECTS_PAGE_LIMIT } from "./constants";
import { buildStatsByProjectId } from "./stats";

interface LoadMoreProjectsParams extends AuthenticatedRequest {
  cursor: string | null;
}

export const loadMoreProjects = withSession<
  LoadMoreProjectsParams,
  {
    projects: Awaited<
      ReturnType<typeof projectService.listProjects>
    >["projects"];
    nextCursor: string | null;
    statsByProjectId: ReturnType<typeof buildStatsByProjectId>;
  }
>(async ({ cursor }) => {
  const page = await projectService.listProjects({
    cursor,
    limit: PROJECTS_PAGE_LIMIT,
  });
  const projectIds = page.projects.map((project) => project.id);
  const stats = await projectService.getProjectsStats(projectIds);

  return {
    projects: page.projects,
    nextCursor: page.pagination?.nextCursor ?? null,
    statsByProjectId: buildStatsByProjectId(stats),
  };
});
