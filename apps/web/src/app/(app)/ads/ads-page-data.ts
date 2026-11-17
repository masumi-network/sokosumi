import "server-only";

import { cacheLife } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";
import { adsService } from "@/lib/services/ads.service";
import { projectService } from "@/lib/services/project.service";

async function readAdsPageScope(projectId: string) {
  const project = await projectService.getProjectById(projectId);
  if (!project) {
    return null;
  }
  const accounts = await adsService.listAccounts(project.id);
  return { project, accounts };
}

type AdsPageScope = Awaited<ReturnType<typeof readAdsPageScope>>;

async function readPrivateCachedAdsPageScope(
  projectId: string,
): Promise<AdsPageScope> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  return readAdsPageScope(projectId);
}

/**
 * The ads page's project and ad accounts, cached for the browser only, so a
 * link prefetch carries the page. Null when the project is not available. A
 * failed read is never kept: the page then renders fresh on the click, with
 * the same reads uncached.
 */
export function loadAdsPageScope(projectId: string): Promise<AdsPageScope> {
  return readPrivateCachedAdsPageScope(projectId).catch(
    async (error: unknown) => {
      unstable_rethrow(error);
      await connection();
      return readAdsPageScope(projectId);
    },
  );
}
