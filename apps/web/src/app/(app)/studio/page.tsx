import { ImagePlus } from "lucide-react";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";

import { ImageStudio } from "@/app/projects/components/image-studio/image-studio";
import { buildStudioLabels } from "@/app/projects/components/image-studio/studio-labels";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { imageStudioService } from "@/lib/services/image-studio.service";
import { projectService } from "@/lib/services/project.service";

import { StudioPageShell } from "./components/studio-page-shell";
import { StudioProjectPicker } from "./components/studio-project-picker";

// Wait for the current session and project access before rendering.
export const instant = false;

interface StudioPageProps {
  searchParams: Promise<{ projectId?: string; v?: string }>;
}

/**
 * The image studio, as a top-level destination.
 *
 * It reads its project from `?projectId=`, which is the same scope every other
 * workspace page reads — so the sidebar's project switcher moves the studio
 * between projects without the studio knowing anything about the switcher, and
 * `ProjectScopeGuard` clears a project this workspace can no longer see.
 */
export default async function StudioPage({ searchParams }: StudioPageProps) {
  await connection();

  const query = await searchParams;
  const t = await getTranslations("App.Studio");
  const projectId = query.projectId?.trim();

  if (!projectId) {
    return (
      <StudioPageShell
        mark={<ImagePlus className="text-muted-foreground size-5" />}
        subtitle={t("noProject")}
        title={t("title")}
      >
        <StudioProjectPicker />
      </StudioPageShell>
    );
  }

  const project = await projectService.getProjectById(projectId);
  // Not `notFound()`: the id came from a switchable scope, not from the path,
  // so the repair is to pick another project rather than to leave the page.
  if (!project) {
    return (
      <StudioPageShell
        mark={<ImagePlus className="text-muted-foreground size-5" />}
        subtitle={t("noProject")}
        title={t("title")}
      >
        <StudioProjectPicker notice={t("pickUnavailable")} />
      </StudioPageShell>
    );
  }

  const state = await loadStudioState(project.id, query.v);

  const initialSelectedAssetId =
    query.v && state.assets.some((asset) => asset.id === query.v)
      ? query.v
      : null;

  return (
    <StudioPageShell
      mark={
        <ProjectAvatar
          name={project.name}
          logo={project.logo}
          className="size-9 rounded-lg text-sm"
        />
      }
      subtitle={project.name}
      title={t("title")}
    >
      <ImageStudio
        initialSelectedAssetId={initialSelectedAssetId}
        initialState={state}
        labels={buildStudioLabels(t)}
        projectId={project.id}
      />
    </StudioPageShell>
  );
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
 */
async function loadStudioState(projectId: string, assetId: string | undefined) {
  if (!assetId) return imageStudioService.getState(projectId, {});

  try {
    return await imageStudioService.getState(projectId, { assetId });
  } catch (error) {
    console.warn("Image studio: ignoring an unusable selection from the URL", {
      projectId,
      error,
    });
    return imageStudioService.getState(projectId, {});
  }
}
