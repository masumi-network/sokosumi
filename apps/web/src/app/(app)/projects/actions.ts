"use server";

import { projectService } from "@/lib/services/project.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

import { PROJECTS_PAGE_LIMIT } from "./constants";

interface LoadMoreProjectsParams extends AuthenticatedRequest {
  cursor: string | null;
  /** Carries the active name filter so later pages stay inside it. */
  query?: string;
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
>(async ({ cursor, query, expectedScope, session }) => {
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
    query,
  });

  return {
    projects: page.projects,
    nextCursor: page.pagination?.nextCursor ?? null,
  };
});

interface ProjectPinParams extends AuthenticatedRequest {
  projectId: string;
}

/**
 * Product UI says Pin; Core says star (ADR 0017). Both actions are idempotent
 * at Core, so a double click cannot reorder the reader's Pins or fail.
 */
export const pinProjectAction = withSession<
  ProjectPinParams,
  Awaited<ReturnType<typeof projectService.pinProject>>
>(async ({ projectId }) => projectService.pinProject(projectId));

export const unpinProjectAction = withSession<
  ProjectPinParams,
  Awaited<ReturnType<typeof projectService.unpinProject>>
>(async ({ projectId }) => projectService.unpinProject(projectId));

interface LoadPinnedProjectsParams extends AuthenticatedRequest {
  expectedScope?: { userId: string; organizationId: string | null };
}

/**
 * The flyout's Pinned rows. Fetched apart from the activity page because a
 * Pinned project is usually a quiet one and would otherwise fall off it
 * (ADR 0036).
 */
export const loadPinnedProjects = withSession<
  LoadPinnedProjectsParams,
  Awaited<ReturnType<typeof projectService.listPinnedProjects>>
>(async ({ expectedScope, session }) => {
  if (
    expectedScope &&
    (expectedScope.userId !== session.user.id ||
      expectedScope.organizationId !==
        (session.session.activeOrganizationId ?? null))
  ) {
    throw new Error("Project workspace changed");
  }

  return projectService.listPinnedProjects();
});
