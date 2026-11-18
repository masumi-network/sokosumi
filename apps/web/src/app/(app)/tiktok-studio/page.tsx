import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { PROJECTS_WORKSPACE_SHELL_CLASS } from "@/app/projects/constants";
import { CmoProjectBanner } from "@/components/cmo-project-banner";
import { RefreshPrefetchedPage } from "@/components/refresh-prefetched-page.client";
import { cn } from "@/lib/utils";

import { TikTokStudio } from "./components/tiktok-studio";
import { TikTokStudioProjectPrompt } from "./components/tiktok-studio-project-prompt";
import { loadTikTokStudioPageData } from "./tiktok-studio-page-data";

// Wait for the current session and project access before rendering.
export const instant = false;

interface TikTokStudioPageProps {
  searchParams: Promise<{ projectId?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.TikTokStudio");
  return { title: t("title") };
}

/**
 * Talking videos, as a top-level destination beside the Content Studio.
 *
 * It reads its project from `?projectId=`, the scope every workspace page
 * reads, so the sidebar's project switcher moves it between projects. A video
 * belongs to a project: its brand writes the scripts and its Files keep the
 * result, so with no project the page asks for one.
 */
export default async function TikTokStudioPage({
  searchParams,
}: TikTokStudioPageProps) {
  const query = await searchParams;
  const t = await getTranslations("App.TikTokStudio");
  const projectId = query.projectId?.trim();
  const { project, talkingVideo, videos } =
    await loadTikTokStudioPageData(projectId);

  return (
    <div
      className={cn(
        PROJECTS_WORKSPACE_SHELL_CLASS,
        "flex min-h-0 min-w-0 flex-1 flex-col gap-2",
      )}
    >
      <RefreshPrefetchedPage />
      <header className="px-2 pt-1">
        <h1 className="text-lg font-semibold text-balance">{t("title")}</h1>
        <p className="text-muted-foreground text-sm text-pretty">
          {t("intro")}
        </p>
      </header>
      {project?.cmo ? <CmoProjectBanner projectId={project.id} /> : null}
      {project ? (
        <TikTokStudio
          catalog={talkingVideo}
          initialVideos={videos}
          // Remounted per project: no draft or selection survives the switch.
          key={project.id}
          projectId={project.id}
          readOnly={project.cmo}
        />
      ) : (
        <TikTokStudioProjectPrompt
          body={projectId ? t("pickUnavailable") : t("pickBody")}
          title={t("pickTitle")}
        />
      )}
    </div>
  );
}
