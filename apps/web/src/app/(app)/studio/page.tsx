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
  searchParams: Promise<{ projectId?: string; s?: string; v?: string }>;
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
        subtitle={t("pickBody")}
        title={t("studio")}
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
        subtitle={t("pickUnavailable")}
        title={t("studio")}
      >
        <StudioProjectPicker notice={t("pickUnavailable")} />
      </StudioPageShell>
    );
  }

  const state = await imageStudioService.getState(project.id, {
    // A selection in the URL may be older than the newest page, so Core is
    // told to include it whatever its age.
    ...(query.v ? { assetId: query.v } : {}),
  });

  // A session id in the URL is a request to resume, not a right to. Only a
  // conversation Core reports as bound to this project is handed to the client.
  const resumeSessionId =
    query.s &&
    state.sessions.some((session) => session.eveSessionId === query.s)
      ? query.s
      : (state.sessions[0]?.eveSessionId ?? null);

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
      title={t("studio")}
    >
      <ImageStudio
        initialSelectedAssetId={initialSelectedAssetId}
        initialState={state}
        labels={buildStudioLabels(t)}
        projectId={project.id}
        resumeSessionId={resumeSessionId}
      />
    </StudioPageShell>
  );
}
