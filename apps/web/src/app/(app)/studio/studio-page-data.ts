import "server-only";

import { cacheLife } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";

import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";
import { imageStudioService } from "@/lib/services/image-studio.service";
import { projectService } from "@/lib/services/project.service";

export interface StudioPageDataInput {
  /** The trimmed `?projectId=`, if any. */
  projectId: string | undefined;
  /** The `?v=` selection hint, if any. */
  assetId: string | undefined;
}

/**
 * The studio's state, with the selection in the URL treated as a hint.
 *
 * `?v=` arrives from a link somebody saved or pasted, so it can name an asset
 * that has since been deleted, one that belongs to a different project, or a
 * string that is not an id at all. Core rejects all three, and asking for the
 * selection is only an optimisation — it makes Core include that asset even if
 * it is older than the newest page. A failed hint therefore costs one extra
 * round trip and nothing else; before this it took the whole studio down with
 * an error boundary, which is a hard way to learn that a bookmark went stale.
 *
 * Only the fresh read falls back to the newest page. Inside the prefetch
 * cache a refused hint throws, so the page renders fresh on the click: the
 * open studio keeps its first state, and the refresh on mount could not
 * replace a fallback kept there.
 */
async function loadStudioState(
  projectId: string,
  assetId: string | undefined,
  fresh: boolean,
) {
  const load = (query: { assetId?: string }) =>
    imageStudioService.getState(projectId, query);
  if (!assetId) return load({});
  if (!fresh) return load({ assetId });

  try {
    return await load({ assetId });
  } catch (error) {
    unstable_rethrow(error);
    console.warn("Image studio: ignoring an unusable selection from the URL", {
      projectId,
      error,
    });
    return load({});
  }
}

/**
 * A shortcut, not the page: without it All projects falls back to the
 * first-ad screen, which still works.
 */
async function loadRecentProjects() {
  try {
    return await imageStudioService.getRecentProjects();
  } catch (error) {
    unstable_rethrow(error);
    console.warn("Image studio: recent projects unavailable", { error });
    return [];
  }
}

async function readStudioPageData(
  { projectId, assetId }: StudioPageDataInput,
  fresh: boolean,
) {
  const project = projectId
    ? await projectService.getProjectById(projectId)
    : null;
  // Not `notFound()`: the id came from a switchable scope, not from the path,
  // so the repair is to pick another project rather than to leave the page.
  const scopeId = project?.id ?? null;

  // In parallel, and the catalog only once per render: it is ~158KB and it is
  // deliberately no longer part of the state payload the open studio refetches
  // every three seconds.
  const [state, catalog, recentProjects] = await Promise.all([
    scopeId
      ? loadStudioState(scopeId, assetId, fresh)
      : Promise.resolve({ assets: [], jobs: [], nextCursor: null }),
    imageStudioService.getCatalog(),
    scopeId ? [] : loadRecentProjects(),
  ]);
  // Read here, inside the cache: a clock read while the page renders for a
  // prefetch would stop that prefetch.
  const now = new Date();
  return { project, scopeId, state, catalog, recentProjects, now };
}

type StudioPageData = Awaited<ReturnType<typeof readStudioPageData>>;

async function readPrivateCachedStudioPageData(
  input: StudioPageDataInput,
): Promise<StudioPageData> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  return readStudioPageData(input, false);
}

/**
 * The studio's Core reads, cached for the browser only, so a link prefetch
 * carries the page. A read that throws is never kept: the page then renders
 * fresh on the click, with the same reads uncached. Recent projects that
 * failed into an empty list are kept for the stale window, until the refresh
 * on mount replaces them.
 */
export function loadStudioPageData(
  input: StudioPageDataInput,
): Promise<StudioPageData> {
  return readPrivateCachedStudioPageData(input).catch(
    async (error: unknown) => {
      unstable_rethrow(error);
      await connection();
      return readStudioPageData(input, true);
    },
  );
}
