import "server-only";

import { cacheLife } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";

import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";
import { projectService } from "@/lib/services/project.service";

async function readProjectOverviewData(projectId: string) {
  const project = await projectService.getProjectById(projectId);
  if (!project) return null;

  const [closeStatus, stats] = await Promise.all([
    project.closingAt || project.closedAt
      ? projectService.getProjectCloseStatus(project.id)
      : Promise.resolve(null),
    // Without counts the strip is left out rather than showing zeros.
    projectService
      .getProjectsStats([project.id])
      .then(([entry]) => entry ?? null)
      .catch((error: unknown) => {
        console.warn("Project Overview task counts failed", { error });
        return null;
      }),
  ]);
  return { project, closeStatus, stats };
}

type ProjectOverviewData = Awaited<ReturnType<typeof readProjectOverviewData>>;

async function readPrivateCachedProjectOverviewData(
  projectId: string,
): Promise<ProjectOverviewData> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  return readProjectOverviewData(projectId);
}

/**
 * The project, its close status and its task counts, cached for the browser
 * only, so a link prefetch carries the Overview. Null when the project is not
 * available. A read that throws is never kept: the page then renders fresh on
 * the click, with the same reads uncached. Counts that failed into a missing
 * strip are kept for the stale window, until the refresh on mount replaces
 * them.
 */
export function loadProjectOverviewData(
  projectId: string,
): Promise<ProjectOverviewData> {
  return readPrivateCachedProjectOverviewData(projectId).catch(
    async (error: unknown) => {
      unstable_rethrow(error);
      await connection();
      return readProjectOverviewData(projectId);
    },
  );
}
