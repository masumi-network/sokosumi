import "server-only";

import type { ProjectListItem } from "@sokosumi/core-client";
import { cacheLife } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import {
  PROJECTS_LIST_STATES,
  PROJECTS_PAGE_LIMIT,
  type ProjectsListProject,
  type ProjectsListState,
  projectsListStateQuery,
} from "@/app/projects/constants";
import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";
import { projectService } from "@/lib/services/project.service";

export interface ProjectsPageDataInput {
  query: string;
  state: ProjectsListState;
}

/**
 * A closing card says what its close still owes. Closing projects are rare,
 * so one status read per closing card on the page; a failed read leaves the
 * card its badge alone.
 */
export async function withCloseStatus(
  projects: ProjectListItem[],
): Promise<ProjectsListProject[]> {
  return Promise.all(
    projects.map(async (project) => {
      if (!project.closingAt || project.closedAt) return project;
      const status = await projectService
        .getProjectCloseStatus(project.id)
        .catch((error: unknown) => {
          unstable_rethrow(error);
          return null;
        });
      return {
        ...project,
        closeStatus: status
          ? {
              state: status.state,
              owedOccurrenceCount: status.owedOccurrenceCount,
            }
          : null,
      };
    }),
  );
}

async function readProjectsPageData({ query, state }: ProjectsPageDataInput) {
  const page = await projectService.listProjects({
    limit: PROJECTS_PAGE_LIMIT,
    query,
    ...projectsListStateQuery(state),
  });
  const projectsPage = {
    ...page,
    projects: await withCloseStatus(page.projects),
  };
  // A filter that matches nothing here may match in another view; the empty
  // state names those views instead of saying nothing matches.
  const otherMatches: ProjectsListState[] =
    query && page.projects.length === 0
      ? (
          await Promise.all(
            PROJECTS_LIST_STATES.filter((other) => other !== state).map(
              async (other) =>
                (
                  await projectService.listProjects({
                    limit: 1,
                    query,
                    state: other,
                  })
                ).projects.length > 0
                  ? other
                  : null,
            ),
          )
        ).filter((other) => other !== null)
      : [];
  // An empty Open view reads "No projects yet" only when there is truly
  // nothing; one Closed project is enough to say "all closed" instead.
  const hasClosedProjects =
    state === "open" &&
    !query &&
    projectsPage.projects.length === 0 &&
    (await projectService.listProjects({ limit: 1, state: "closed" })).projects
      .length > 0;

  return { projectsPage, hasClosedProjects, otherMatches };
}

type ProjectsPageData = Awaited<ReturnType<typeof readProjectsPageData>>;

async function readPrivateCachedProjectsPageData(
  input: ProjectsPageDataInput,
): Promise<ProjectsPageData> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  return readProjectsPageData(input);
}

/**
 * The projects page's Core reads, cached for the browser only, so a link
 * prefetch carries the page. A failed read is never kept: the page then
 * renders fresh on the click, with the same reads uncached.
 */
export function loadProjectsPageData(
  input: ProjectsPageDataInput,
): Promise<ProjectsPageData> {
  return readPrivateCachedProjectsPageData(input).catch(
    async (error: unknown) => {
      unstable_rethrow(error);
      await connection();
      return readProjectsPageData(input);
    },
  );
}
