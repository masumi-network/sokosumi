import "server-only";

import { cacheLife } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import {
  PROJECTS_PAGE_LIMIT,
  type ProjectsListState,
  projectsListStateQuery,
} from "@/app/projects/constants";
import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";
import { projectService } from "@/lib/services/project.service";

export interface ProjectsPageDataInput {
  query: string;
  state: ProjectsListState;
}

async function readProjectsPageData({ query, state }: ProjectsPageDataInput) {
  // The featured card leads the unfiltered Open view only.
  const [projectsPage, featured] = await Promise.all([
    projectService.listProjects({
      limit: PROJECTS_PAGE_LIMIT,
      query,
      ...projectsListStateQuery(state),
    }),
    state === "open" && !query ? projectService.getFeaturedProject() : null,
  ]);
  // An empty Open view reads "No projects yet" only when there is truly
  // nothing; one Closed project is enough to say "all closed" instead.
  const hasClosedProjects =
    state === "open" &&
    !query &&
    projectsPage.projects.length === 0 &&
    (await projectService.listProjects({ limit: 1, state: "closed" })).projects
      .length > 0;

  return { projectsPage, hasClosedProjects, featured };
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
