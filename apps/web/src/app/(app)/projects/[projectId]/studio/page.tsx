import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { ImageStudio } from "@/app/projects/components/image-studio/image-studio";
import type { StudioLabels } from "@/app/projects/components/image-studio/types";
import {
  getProjectWorkspaceLabels,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import { imageStudioService } from "@/lib/services/image-studio.service";
import { projectService } from "@/lib/services/project.service";
import { hasCurrentUserSocialBetaAccess } from "@/lib/social-beta-access.server";

// Wait for the current session and project access before rendering.
export const instant = false;

interface ProjectStudioPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ v?: string; s?: string }>;
}

export default async function ProjectStudioPage({
  params,
  searchParams,
}: ProjectStudioPageProps) {
  await connection();

  const [{ projectId }, query, socialBetaEnabled] = await Promise.all([
    params,
    searchParams,
    hasCurrentUserSocialBetaAccess(),
  ]);
  const project = await projectService.getProjectById(projectId);
  if (!project) {
    notFound();
  }

  const [state, t, formatter] = await Promise.all([
    imageStudioService.getState(project.id, {
      // A selection in the URL may be older than the newest page, so Core is
      // told to include it whatever its age.
      ...(query.v ? { assetId: query.v } : {}),
    }),
    getTranslations("App.Projects.Detail.imageStudio"),
    getFormatter(),
  ]);
  const workspaceLabels = await getProjectWorkspaceLabels();

  const labels: StudioLabels = {
    emptyTitle: t("emptyTitle"),
    emptyBody: t("emptyBody"),
    examplePrompts: [t("example1"), t("example2"), t("example3")],
    promptPlaceholder: t("promptPlaceholder"),
    generate: t("generate"),
    refine: t("refine"),
    regenerate: t("regenerate"),
    download: t("download"),
    compare: t("compare"),
    approve: t("approve"),
    reject: t("reject"),
    undecided: t("undecided"),
    approved: t("approved"),
    rejected: t("rejected"),
    clearReview: t("clearReview"),
    feedbackPlaceholder: t("feedbackPlaceholder"),
    version: t("version"),
    generating: t("generating"),
    queued: t("queued"),
    failed: t("failed"),
    uncertainTitle: t("uncertainTitle"),
    uncertainBody: t("uncertainBody"),
    checkAgain: t("checkAgain"),
    submitAnyway: t("submitAnyway"),
    tryAgain: t("tryAgain"),
    cancel: t("cancel"),
    cancelRequested: t("cancelRequested"),
    chatTitle: t("chatTitle"),
    chatUnavailable: t("chatUnavailable"),
    send: t("send"),
    clearFilter: t("clearFilter"),
    filterAll: t("filterAll"),
    filterApproved: t("filterApproved"),
    lineage: t("lineage"),
    from: t("from"),
    you: t("you"),
    studio: t("studio"),
    thinking: t("thinking"),
    assistantError: t("assistantError"),
    assistantErrorHint: t("assistantErrorHint"),
    loadOlder: t("loadOlder"),
    errorSessionExpired: t("errorSessionExpired"),
    errorRefreshFailed: t("errorRefreshFailed"),
    errorLoadOlderFailed: t("errorLoadOlderFailed"),
    retryConnection: t("retryConnection"),
    composerTitle: t("composerTitle"),
    model: t("model"),
    placement: t("placement"),
    placementNone: t("placementNone"),
    placementTarget: t("placementTarget"),
    placementNotOutput: t("placementNotOutput"),
    aspectRatio: t("aspectRatio"),
    resolution: t("resolution"),
    outputFormat: t("outputFormat"),
    copies: t("copies"),
    frameSetByPlacement: t("frameSetByPlacement"),
    moreOptions: t("moreOptions"),
    generateOne: t("generateOne"),
    modelUnsupportedForPlacement: t("modelUnsupportedForPlacement"),
    modelNotInCatalog: t("modelNotInCatalog"),
    waitingForSlot: t("waitingForSlot"),
    waitingForSlotBody: t("waitingForSlotBody"),
    queueNotDurable: t("queueNotDurable"),
    gallery: t("gallery"),
    filterRejected: t("filterRejected"),
    filterUndecided: t("filterUndecided"),
    noneMatchFilter: t("noneMatchFilter"),
    select: t("select"),
    deselect: t("deselect"),
    compareSelected: t("compareSelected"),
    clearSelection: t("clearSelection"),
    openDetails: t("openDetails"),
    close: t("close"),
    dimensions: t("dimensions"),
    created: t("created"),
    seed: t("seed"),
    noSeed: t("noSeed"),
    parentVersion: t("parentVersion"),
    compareHint: t("compareHint"),
    compareNeedsTwo: t("compareNeedsTwo"),
    bytesUnavailable: t("bytesUnavailable"),
    previousVersion: t("previousVersion"),
    nextVersion: t("nextVersion"),
    assistant: t("assistant"),
    chatCollapse: t("chatCollapse"),
    chatEmptyBody: t("chatEmptyBody"),
    chatExpand: t("chatExpand"),
    jumpToLatest: t("jumpToLatest"),
  };

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
    <ProjectWorkspaceShell
      metadata={[
        {
          label: t("updated"),
          value: formatter.dateTime(project.updatedAt, "dateTime"),
        },
      ]}
      labels={workspaceLabels}
      projectId={project.id}
      projectLogo={project.logo}
      projectName={project.name}
      showSocialTab={socialBetaEnabled}
      websiteUrl={project.websiteUrl}
    >
      <ImageStudio
        initialSelectedAssetId={initialSelectedAssetId}
        initialState={state}
        labels={labels}
        projectId={project.id}
        resumeSessionId={resumeSessionId}
      />
    </ProjectWorkspaceShell>
  );
}
