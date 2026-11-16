import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ImageStudio } from "@/app/projects/components/image-studio/image-studio";
import { buildStudioLabels } from "@/app/projects/components/image-studio/studio-labels";
import { ProjectBrandProvider } from "@/app/projects/components/project-brand-card";
import { CmoProjectBanner } from "@/components/cmo-project-banner";
import { RefreshPrefetchedPage } from "@/components/refresh-prefetched-page.client";

import { StudioPageShell } from "./components/studio-page-shell";
import { StudioProjectScopePrompt } from "./components/studio-project-scope-prompt";
import { StudioRecentProjects } from "./components/studio-recent-projects";
import { loadStudioPageData } from "./studio-page-data";

// Wait for the current session and project access before rendering.
export const instant = false;

interface StudioPageProps {
  searchParams: Promise<{ projectId?: string; v?: string }>;
}

/**
 * The product name, for the tab and anything that quotes the document title.
 *
 * The page carries no visible headline, so this and the shell's `sr-only` `h1`
 * are the only two places it says what it is. They deliberately read the same
 * key, so the tab and the heading outline can never disagree.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Studio");
  return { title: t("title") };
}

/**
 * The image studio, as a top-level destination.
 *
 * It reads its project from `?projectId=`, which is the same scope every other
 * workspace page reads — so the sidebar's project switcher moves the studio
 * between projects without the studio knowing anything about the switcher, and
 * `ProjectScopeGuard` clears a project this workspace can no longer see.
 *
 * With no project it offers curated styles, with the header's project
 * selector opened over them on request. Generation asks which project it goes
 * to; existing images are loaded only for a selected project.
 */
export default async function StudioPage({ searchParams }: StudioPageProps) {
  const query = await searchParams;
  const t = await getTranslations("App.Studio");
  const projectId = query.projectId?.trim();
  const { project, scopeId, state, catalog, recentProjects } =
    await loadStudioPageData({ projectId, assetId: query.v });

  const initialSelectedAssetId =
    query.v && state.assets.some((asset) => asset.id === query.v)
      ? query.v
      : null;

  const studio = (
    <>
      {/* The curated styles are the backdrop the selector opens over. */}
      <ImageStudio
        catalog={catalog}
        initialSelectedAssetId={initialSelectedAssetId}
        initialState={state}
        // Remounted per project, so no filter, selection, draft prompt or
        // queued request from the previous one can survive the switch. The
        // state hook resets on its own too; see `useStudioState`. The one
        // exception is a brief typed in the All-projects view, which moves to
        // a project picked or created from its own prompt
        // (`studio-workspace-brief.ts`).
        key={scopeId ?? "workspace"}
        labels={buildStudioLabels(t)}
        projectId={scopeId}
        readOnly={project?.cmo}
        projectLogo={project?.logo}
        studioLogoPosition={project?.studioLogoPosition}
        websiteUrl={project?.websiteUrl}
        recentProjects={
          recentProjects.length > 0 ? (
            <StudioRecentProjects now={new Date()} projects={recentProjects} />
          ) : undefined
        }
        projectScopePrompt={
          scopeId ? undefined : (
            <StudioProjectScopePrompt
              body={projectId ? t("pickUnavailable") : t("pickBody")}
              createActionLabel={t("startFromWebsite")}
            />
          )
        }
      />
    </>
  );
  return (
    <StudioPageShell title={t("title")}>
      <RefreshPrefetchedPage />
      {project?.cmo ? (
        <CmoProjectBanner className="mb-4" projectId={project.id} />
      ) : null}
      {project ? (
        <ProjectBrandProvider
          autoStart={false}
          initialDesignMd={project.designMd ?? null}
          key={project.id}
          projectId={project.id}
          websiteUrl={project.websiteUrl}
        >
          {studio}
        </ProjectBrandProvider>
      ) : (
        studio
      )}
    </StudioPageShell>
  );
}
