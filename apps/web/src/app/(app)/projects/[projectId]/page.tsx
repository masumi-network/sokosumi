import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  ProjectBrandCard,
  ProjectBrandProvider,
} from "@/app/projects/components/project-brand-card";
import { ProjectBriefing } from "@/app/projects/components/project-briefing";
import { ProjectCloseStatusCard } from "@/app/projects/components/project-close-status";
import { ProjectDetailActions } from "@/app/projects/components/project-detail-actions";
import { ProjectDetailPinButton } from "@/app/projects/components/project-detail-pin-button";
import { ProjectLatestUpdate } from "@/app/projects/components/project-latest-update";
import {
  getProjectWorkspaceLabels,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import { projectService } from "@/lib/services/project.service";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await projectService.getProjectById(projectId);

  if (!project) {
    notFound();
  }

  const [closeStatus, t, tList, formatter] = await Promise.all([
    project.closingAt || project.closedAt
      ? projectService.getProjectCloseStatus(project.id)
      : Promise.resolve(null),
    getTranslations("App.Projects.Detail"),
    getTranslations("App.Projects.list"),
    getFormatter(),
  ]);
  const workspaceLabels = await getProjectWorkspaceLabels();

  return (
    <ProjectWorkspaceShell
      actions={
        <div className="flex items-center gap-1">
          <ProjectDetailPinButton
            projectId={project.id}
            isClosed={Boolean(project.closingAt || project.closedAt)}
            labels={{
              pin: tList("pin"),
              unpin: tList("unpin"),
              error: tList("pinError"),
            }}
          />
          <ProjectDetailActions
            projectId={project.id}
            projectRevision={project.projectRevision}
            isClosingOrClosed={Boolean(project.closingAt || project.closedAt)}
            labels={{
              moreActions: t("actions.moreActions"),
              edit: t("actions.edit"),
              close: t("actions.close"),
              closeDialog: {
                title: t("close.dialog.title"),
                description: t("close.dialog.description"),
                reasonLabel: t("close.dialog.reasonLabel"),
                reasonPlaceholder: t("close.dialog.reasonPlaceholder"),
                confirm: t("close.dialog.confirm"),
                cancel: t("close.dialog.cancel"),
                success: t("close.dialog.success"),
                error: t("close.dialog.error"),
              },
            }}
          />
        </div>
      }
      createdAt={formatter.dateTime(project.createdAt, "dateTime")}
      updatedAt={formatter.dateTime(project.updatedAt, "dateTime")}
      labels={workspaceLabels}
      projectId={project.id}
      projectLogo={project.logo}
      projectName={project.name}
      websiteUrl={project.websiteUrl}
    >
      {/*
        One column of sections with the quiet heading a task section uses;
        the close status stays a card because it is an alert. The width is
        capped because the briefing is prose.
      */}
      <ProjectBrandProvider
        key={project.designMd?.url ?? "project-brand-empty"}
        projectId={project.id}
        initialDesignMd={project.designMd}
        websiteUrl={project.websiteUrl}
      >
        <div className="max-w-3xl min-w-0 space-y-8">
          {closeStatus ? <ProjectCloseStatusCard status={closeStatus} /> : null}

          {project.latestUpdate ? (
            <ProjectLatestUpdate
              title={t("latestUpdate")}
              content={project.latestUpdate.content}
              showMoreLabel={t("showMore")}
              showLessLabel={t("showLess")}
            />
          ) : null}

          <ProjectBriefing
            title={t("briefing")}
            briefing={project.briefing}
            emptyLabel={t("emptyBriefing")}
            emptyActionLabel={t("writeBriefing")}
            editHref={`/projects/${project.id}/edit`}
            showMoreLabel={t("showMore")}
            showLessLabel={t("showLess")}
          />

          <ProjectBrandCard
            projectId={project.id}
            projectName={project.name}
            logo={project.logo}
            websiteUrl={project.websiteUrl}
          />
        </div>
      </ProjectBrandProvider>
    </ProjectWorkspaceShell>
  );
}
