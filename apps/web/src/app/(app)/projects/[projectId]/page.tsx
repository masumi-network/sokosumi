import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  ProjectBrandCard,
  ProjectBrandProvider,
} from "@/app/projects/components/project-brand-card";
import { ProjectBriefing } from "@/app/projects/components/project-briefing";
import { ProjectCloseStatusCard } from "@/app/projects/components/project-close-status";
import { ProjectHeaderActions } from "@/app/projects/components/project-header-actions";
import { ProjectLatestUpdate } from "@/app/projects/components/project-latest-update";
import {
  ProjectStatusStrip,
  projectTaskCounts,
} from "@/app/projects/components/project-status-strip";
import {
  getProjectWorkspaceLabels,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import {
  panelFeed,
  WorkspaceColumn,
} from "@/app/projects/components/workspace-column";
import { WORKSPACE_COLUMN_ROWS } from "@/app/projects/constants";
import { notificationService } from "@/lib/services/notification.service";
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

  // Started before the page's own awaits, awaited inside their panels'
  // boundaries, so a slow feed holds up nothing above it.
  const needsYou = panelFeed(
    notificationService.listNeedsYou(WORKSPACE_COLUMN_ROWS, project.id),
  );
  const activity = panelFeed(
    projectService.listRecentActivity(WORKSPACE_COLUMN_ROWS, project.id),
  );

  const [closeStatus, stats, t, formatter] = await Promise.all([
    project.closingAt || project.closedAt
      ? projectService.getProjectCloseStatus(project.id)
      : Promise.resolve(null),
    // Without counts the strip is left out rather than showing zeros.
    projectService
      .getProjectsStats([project.id])
      .then(([entry]) => entry ?? null)
      .catch((error: unknown) => {
        console.warn("Project Overview task counts failed", { error });
        return null;
      }),
    getTranslations("App.Projects.Detail"),
    getFormatter(),
  ]);
  const workspaceLabels = await getProjectWorkspaceLabels();

  return (
    <ProjectWorkspaceShell
      actions={
        <ProjectHeaderActions
          closedAt={project.closedAt}
          closingAt={project.closingAt}
          projectId={project.id}
          projectRevision={project.projectRevision}
          scheduledSocialPostCount={project.scheduledSocialPostCount}
        />
      }
      createdAt={formatter.dateTime(project.createdAt, "dateTime")}
      updatedAt={formatter.dateTime(project.updatedAt, "dateTime")}
      labels={workspaceLabels}
      identifier={project.identifier}
      projectId={project.id}
      projectLogo={project.logo}
      projectName={project.name}
      websiteUrl={project.websiteUrl}
      // A Closed project keeps both panels: its history stays readable, and
      // Needs you is simply empty once nothing in it waits.
      panels={
        <WorkspaceColumn
          needsYou={needsYou}
          activity={activity}
          projects={{
            [project.id]: { name: project.name, logo: project.logo },
          }}
          projectScoped
        />
      }
    >
      {/*
        One column of sections with the quiet heading a task section uses;
        the close status stays a card because it is an alert. It fills the
        column, so every section ends on the same edge as the tabs and the
        header's actions.
      */}
      <ProjectBrandProvider
        key={project.designMd?.url ?? "project-brand-empty"}
        projectId={project.id}
        initialDesignMd={project.designMd}
        websiteUrl={project.websiteUrl}
      >
        <div className="min-w-0 space-y-8">
          {closeStatus ? <ProjectCloseStatusCard status={closeStatus} /> : null}

          {stats ? (
            <ProjectStatusStrip
              projectId={project.id}
              counts={projectTaskCounts(stats.tasks)}
              formatCount={(value) => formatter.number(value)}
              labels={{
                label: t("stats.label"),
                running: t("stats.running"),
                waiting: t("stats.waiting"),
                open: t("stats.open"),
              }}
            />
          ) : null}

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
            websiteUrl={project.websiteUrl}
          />
        </div>
      </ProjectBrandProvider>
    </ProjectWorkspaceShell>
  );
}
