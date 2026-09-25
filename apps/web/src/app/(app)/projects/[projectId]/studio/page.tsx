import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { ImageStudio } from "@/app/projects/components/image-studio/image-studio";
import type { StudioLabels } from "@/app/projects/components/image-studio/types";
import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";
import { PROJECTS_DETAIL_SHELL_CLASS } from "@/app/projects/constants";
import { imageStudioService } from "@/lib/services/image-studio.service";
import { projectService } from "@/lib/services/project.service";

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

  const [{ projectId }, query] = await Promise.all([params, searchParams]);
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

  const labels: StudioLabels = {
    title: t("title"),
    subtitle: t("subtitle"),
    emptyTitle: t("emptyTitle"),
    emptyBody: t("emptyBody"),
    examplePrompts: [t("example1"), t("example2"), t("example3")],
    promptPlaceholder: t("promptPlaceholder"),
    generate: t("generate"),
    refine: t("refine"),
    regenerate: t("regenerate"),
    variations: t("variations"),
    download: t("download"),
    compare: t("compare"),
    compareOff: t("compareOff"),
    approve: t("approve"),
    reject: t("reject"),
    undecided: t("undecided"),
    approved: t("approved"),
    rejected: t("rejected"),
    clearReview: t("clearReview"),
    feedbackPlaceholder: t("feedbackPlaceholder"),
    history: t("history"),
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
    noApproved: t("noApproved"),
    clearFilter: t("clearFilter"),
    filterAll: t("filterAll"),
    filterApproved: t("filterApproved"),
    elapsed: t("elapsed"),
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
    <div className={PROJECTS_DETAIL_SHELL_CLASS}>
      <ProjectDetailHeader
        backHref={`/projects/${project.id}`}
        backLabel={t("back")}
        metadata={[
          {
            label: t("updated"),
            value: formatter.dateTime(project.updatedAt, "dateTime"),
          },
        ]}
        projectLogo={project.logo}
        projectName={project.name}
        showBackOnMobile
        websiteUrl={project.websiteUrl}
      />

      <div className="mt-8">
        <h1 className="text-xl font-medium">{labels.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{labels.subtitle}</p>
      </div>

      <div className="mt-6">
        <ImageStudio
          initialSelectedAssetId={initialSelectedAssetId}
          initialState={state}
          labels={labels}
          projectId={project.id}
          resumeSessionId={resumeSessionId}
        />
      </div>
    </div>
  );
}
