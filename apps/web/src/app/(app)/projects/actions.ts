"use server";

import { projectService } from "@/lib/services/project.service";

import { PROJECTS_PAGE_LIMIT } from "./constants";
import { buildStatsByProjectId } from "./stats";

export async function loadMoreProjects(cursor: string | null) {
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
}
