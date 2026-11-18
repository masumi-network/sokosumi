import "server-only";

import { cacheLife } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";

import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";
import { imageStudioService } from "@/lib/services/image-studio.service";
import { projectService } from "@/lib/services/project.service";

async function readTikTokStudioPageData(projectId: string | undefined) {
  const project = projectId
    ? await projectService.getProjectById(projectId)
    : null;
  // Not `notFound()`: the id came from a switchable scope, not from the path,
  // so the repair is to pick another project rather than to leave the page.
  const [catalog, videos] = await Promise.all([
    imageStudioService.getCatalog(),
    project
      ? imageStudioService.getTalkingVideos(project.id)
      : Promise.resolve({ jobs: [], assets: [] }),
  ]);
  return { project, talkingVideo: catalog.talkingVideo, videos };
}

type TikTokStudioPageData = Awaited<
  ReturnType<typeof readTikTokStudioPageData>
>;

async function readPrivateCachedTikTokStudioPageData(
  projectId: string | undefined,
): Promise<TikTokStudioPageData> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  return readTikTokStudioPageData(projectId);
}

/**
 * The page's Core reads, cached for the browser only, so a link prefetch
 * carries the page. A read that throws is never kept: the page then renders
 * fresh on the click, with the same reads uncached.
 */
export function loadTikTokStudioPageData(
  projectId: string | undefined,
): Promise<TikTokStudioPageData> {
  return readPrivateCachedTikTokStudioPageData(projectId).catch(
    async (error: unknown) => {
      unstable_rethrow(error);
      await connection();
      return readTikTokStudioPageData(projectId);
    },
  );
}
