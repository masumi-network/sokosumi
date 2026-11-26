import "server-only";

import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";
import { projectService } from "@/lib/services/project.service";

async function readPrivateCachedProjectName(
  projectId: string,
): Promise<string | null> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  const project = await projectService.getProjectById(projectId);
  return project?.name ?? null;
}

/**
 * A project page's tab title: the section, then the project, or the project
 * alone on its own page. Next's route announcer reads the title out after a
 * navigation, and only when it changes, so sibling pages need their own.
 * One scoped project read, cached for the browser like the page's. A title
 * never fails the page: without the project it keeps the app's title.
 */
export async function projectPageMetadata(
  projectId: string,
  section?: string,
): Promise<Metadata> {
  const name = await readPrivateCachedProjectName(projectId).catch(
    (error: unknown) => {
      unstable_rethrow(error);
      return null;
    },
  );
  if (!name) return {};
  if (!section) return { title: name };
  const t = await getTranslations("App.Projects.Detail");
  return { title: t("sectionTitle", { section, project: name }) };
}
