import "server-only";

import { cacheLife } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";

import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";
import { projectService } from "@/lib/services/project.service";
import { sokoBotService } from "@/lib/services/soko-bot.service";
import { userService } from "@/lib/services/user.service";

// Thrown, never returned, inside the cache: a missing project must not be
// kept as a 404 for the stale window. Nothing on a 404 page refreshes it.
class ProjectNotAvailable extends Error {}

async function readProjectOverviewData(projectId: string) {
  const project = await projectService.getProjectById(projectId);
  if (!project) return null;

  const [closeStatus, stats, sharedBots, organizationId] = await Promise.all([
    project.closingAt || project.closedAt
      ? projectService.getProjectCloseStatus(project.id)
      : Promise.resolve(null),
    // Without counts the strip is left out rather than showing zeros.
    projectService
      .getProjectsStats([project.id])
      .then(([entry]) => entry ?? null)
      .catch((error: unknown) => {
        unstable_rethrow(error);
        console.warn("Project Overview task counts failed", { error });
        return null;
      }),
    // The Bots tab: Core sends shared bots to a member, and shared bots
    // exist only in an organization.
    sokoBotService.listShared().catch((error: unknown) => {
      unstable_rethrow(error);
      return null;
    }),
    userService.getActiveOrganizationId(),
  ]);
  return {
    project,
    closeStatus,
    stats,
    showBots: Boolean(sharedBots && organizationId),
  };
}

type ProjectOverviewData = NonNullable<
  Awaited<ReturnType<typeof readProjectOverviewData>>
>;

async function readPrivateCachedProjectOverviewData(
  projectId: string,
): Promise<ProjectOverviewData> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  const data = await readProjectOverviewData(projectId);
  if (!data) throw new ProjectNotAvailable();
  return data;
}

/**
 * The project, its close status, its task counts and whether it shows the
 * Bots tab, cached for the browser only, so a link prefetch carries the
 * Overview. Null when the project is not available; that answer is never
 * kept. A read that throws is never kept either: the page then renders fresh
 * on the click, with the same reads uncached. Counts that failed into a missing
 * strip are kept for the stale window, until the refresh on mount replaces
 * them.
 */
export function loadProjectOverviewData(
  projectId: string,
): Promise<ProjectOverviewData | null> {
  return readPrivateCachedProjectOverviewData(projectId).catch(
    async (error: unknown) => {
      unstable_rethrow(error);
      await connection();
      return readProjectOverviewData(projectId);
    },
  );
}
