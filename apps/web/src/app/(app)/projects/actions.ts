"use server";

import { revalidatePath } from "next/cache";
import { projectService } from "@/lib/services/project.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

import {
  PROJECTS_PAGE_LIMIT,
  type ProjectsListState,
  projectsListStateQuery,
} from "./constants";

interface LoadMoreProjectsParams extends AuthenticatedRequest {
  cursor: string | null;
  /** Carries the active name filter so later pages stay inside it. */
  query?: string;
  /** Carries the Open/Hidden/Closed view; its cursor only makes sense inside it. */
  state: ProjectsListState;
}

export const loadMoreProjects = withSession<
  LoadMoreProjectsParams,
  {
    projects: Awaited<
      ReturnType<typeof projectService.listProjects>
    >["projects"];
    nextCursor: string | null;
  }
>(async ({ cursor, query, state }) => {
  const page = await projectService.listProjects({
    cursor,
    limit: PROJECTS_PAGE_LIMIT,
    query,
    ...projectsListStateQuery(state),
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
 * A Pin or a Hide changes what the Projects list and the project header
 * show. Revalidating here puts the new page into the action's own answer, so
 * the caller needs no refresh after it.
 */
async function thenRevalidateProjects<T>(write: Promise<T>): Promise<T> {
  const result = await write;
  revalidatePath("/projects");
  return result;
}

/**
 * Product UI says Pin; Core says star (ADR 0017). Both actions are idempotent
 * at Core, so a double click cannot reorder the reader's Pins or fail.
 */
export const pinProjectAction = withSession<
  ProjectPinParams,
  Awaited<ReturnType<typeof projectService.pinProject>>
>(async ({ projectId }) =>
  thenRevalidateProjects(projectService.pinProject(projectId)),
);

export const unpinProjectAction = withSession<
  ProjectPinParams,
  Awaited<ReturnType<typeof projectService.unpinProject>>
>(async ({ projectId }) =>
  thenRevalidateProjects(projectService.unpinProject(projectId)),
);

/**
 * A Hide is the reader's own and the opposite of a Pin: hiding unpins, and
 * the result says whether it did so Undo can Pin again (ADR 0036). Both are
 * idempotent at Core.
 */
export const hideProjectAction = withSession<
  ProjectPinParams,
  Awaited<ReturnType<typeof projectService.hideProject>>
>(async ({ projectId }) =>
  thenRevalidateProjects(projectService.hideProject(projectId)),
);

export const showProjectAction = withSession<
  ProjectPinParams,
  Awaited<ReturnType<typeof projectService.showProject>>
>(async ({ projectId }) =>
  thenRevalidateProjects(projectService.showProject(projectId)),
);
