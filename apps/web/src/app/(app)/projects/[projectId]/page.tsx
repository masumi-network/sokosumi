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
  getProjectWorkspaceLabelsFor,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import {
  requestPanelFeed,
  WorkspaceColumn,
} from "@/app/projects/components/workspace-column";
import {
  PROJECT_LINE_DATE,
  WORKSPACE_COLUMN_ROWS,
} from "@/app/projects/constants";
import { RefreshPrefetchedPage } from "@/components/refresh-prefetched-page.client";
import { notificationService } from "@/lib/services/notification.service";
import { projectService } from "@/lib/services/project.service";

import { loadProjectOverviewData } from "./project-overview-data";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const data = await loadProjectOverviewData(projectId);

  if (!data) {
    notFound();
  }
  const { project, closeStatus, stats, showBots, isHidden } = data;

  // Started before the page's own awaits, awaited inside their panels'
  // boundaries, so a slow feed holds up nothing above it. Each waits for the
  // request, so a link prefetch leaves the panels as holes.
  const needsYou = requestPanelFeed(() =>
    notificationService.listNeedsYou(WORKSPACE_COLUMN_ROWS, project.id),
  );
  const activity = requestPanelFeed(() =>
    projectService.listRecentActivity(WORKSPACE_COLUMN_ROWS, project.id),
  );

  const [t, formatter, workspaceLabels] = await Promise.all([
    getTranslations("App.Projects.Detail"),
    getFormatter(),
    getProjectWorkspaceLabelsFor(showBots),
  ]);

  return (
    <ProjectWorkspaceShell
      actions={
        <ProjectHeaderActions
          cmo={project.cmo}
          closedAt={project.closedAt}
          closingAt={project.closingAt}
          find
          isHidden={isHidden}
          projectId={project.id}
          projectRevision={project.projectRevision}
          scheduledSocialPostCount={project.scheduledSocialPostCount}
        />
      }
      cmo={project.cmo}
      createdAt={formatter.dateTime(project.createdAt, "dateTime")}
      updatedAt={formatter.dateTime(project.updatedAt, "dateTime")}
      createdOn={formatter.dateTime(project.createdAt, PROJECT_LINE_DATE)}
      updatedOn={formatter.dateTime(project.updatedAt, PROJECT_LINE_DATE)}
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
      {/* Outside the keyed brand provider, so a new design file does not
          remount it and refresh the page a second time. */}
      <RefreshPrefetchedPage />
      {/*
        One column of sections with the quiet heading a task section uses;
        the close status stays a card because it is an alert. It fills the
        column, so every section ends on the same edge as the tabs and the
        header's actions.
      */}
      <ProjectBrandProvider
        key={project.designMd?.url ?? "project-brand-empty"}
        // CMO writes a CMO Project's brand; never start one from here.
        // The design file can be up to the prefetch's stale window old, so a
        // start can read a brand that just finished. Accepted: the refresh on
        // mount brings the current file, and the key then remounts this.
        autoStart={!project.cmo}
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
                done: t("stats.done"),
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
            editHref={project.cmo ? undefined : `/projects/${project.id}/edit`}
            showMoreLabel={t("showMore")}
            showLessLabel={t("showLess")}
          />

          <ProjectBrandCard
            readOnly={project.cmo}
            projectId={project.id}
            websiteUrl={project.websiteUrl}
          />
        </div>
      </ProjectBrandProvider>
    </ProjectWorkspaceShell>
  );
}
