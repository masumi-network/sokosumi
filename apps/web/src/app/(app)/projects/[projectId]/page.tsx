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
import { ProjectMemoryRow } from "@/app/projects/components/project-memory-row";
import { ProjectModuleTiles } from "@/app/projects/components/project-module-tiles";
import { ProjectNeedsAttentionSection } from "@/app/projects/components/project-needs-attention-section";
import {
  getProjectWorkspaceLabels,
  ProjectWorkspaceShell,
} from "@/app/projects/components/project-workspace-shell";
import { PROJECTS_DETAIL_WORKSPACE_CLASS } from "@/app/projects/constants";
import { buildTaskStatusLabels } from "@/app/tasks/utils/task-status-labels";
import { projectService } from "@/lib/services/project.service";
import { hasCurrentUserSocialBetaAccess } from "@/lib/social-beta-access.server";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const [socialBetaEnabled, { projectId }] = await Promise.all([
    hasCurrentUserSocialBetaAccess(),
    params,
  ]);
  const project = await projectService.getProjectById(projectId);

  if (!project) {
    notFound();
  }

  const [
    attention,
    closeStatus,
    t,
    tHistory,
    tList,
    tListStats,
    tTaskFilters,
    formatter,
  ] = await Promise.all([
    projectService.getProjectNeedsAttention(project.id),
    project.closingAt || project.closedAt
      ? projectService.getProjectCloseStatus(project.id)
      : Promise.resolve(null),
    getTranslations("App.Projects.Detail"),
    getTranslations("App.History.Row"),
    getTranslations("App.Projects.list"),
    getTranslations("App.Projects.list.stats"),
    getTranslations("App.Tasks.Filters"),
    getFormatter(),
  ]);
  const workspaceLabels = await getProjectWorkspaceLabels();

  const taskStatusLabels = buildTaskStatusLabels((key) =>
    tTaskFilters(`statusOptions.${key}`),
  );

  /**
   * The areas that are still a promise.
   *
   * Written out rather than derived, because every one of these is a real
   * translated name and next-intl's keys are literals. Social media drops out
   * of the sentence exactly when it becomes a tile.
   */
  const comingSoonAreas = [
    ...(socialBetaEnabled ? [] : [t("modules.socialMedia.title")]),
    t("modules.seo.title"),
    t("modules.email.title"),
    t("modules.paidAdvertising.title"),
    t("modules.content.title"),
    t("modules.pr.title"),
  ];

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
      metadata={[
        {
          label: t("header.updated"),
          value: formatter.dateTime(project.updatedAt, "dateTime"),
        },
        {
          label: t("header.created"),
          value: formatter.dateTime(project.createdAt, "dateTime"),
        },
      ]}
      labels={workspaceLabels}
      projectId={project.id}
      projectLogo={project.logo}
      projectName={project.name}
      showSocialTab={socialBetaEnabled}
      websiteUrl={project.websiteUrl}
    >
      <ProjectBrandProvider
        key={project.designMd?.url ?? "project-brand-empty"}
        projectId={project.id}
        initialDesignMd={project.designMd}
        websiteUrl={project.websiteUrl}
      >
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
          <div className="min-w-0 space-y-8">
            {closeStatus ? (
              <ProjectCloseStatusCard status={closeStatus} />
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
          </div>

          <aside className="min-w-0 space-y-8 xl:row-span-2">
            <ProjectBrandCard
              projectId={project.id}
              projectName={project.name}
              logo={project.logo}
              websiteUrl={project.websiteUrl}
            />
            <ProjectMemoryRow
              projectId={project.id}
              contextMd={project.contextMd}
              contextMdUpdating={project.contextMdUpdating}
              memoryEnabled={project.memoryEnabled}
              memoryModel={project.memoryModel}
            />
          </aside>

          <div className="min-w-0 space-y-8">
            <ProjectNeedsAttentionSection
              projectId={project.id}
              taskCount={attention.taskCount}
              jobCount={attention.jobCount}
              items={attention.items}
              labels={{
                needsAttention: t("needsAttention.title"),
                empty: t("needsAttention.empty"),
                viewAllTasks: t("tasks.viewAll"),
                viewAllJobs: t("jobs.viewAll"),
                counts: {
                  tasks: tListStats("tasks"),
                  jobs: tListStats("jobs"),
                },
                kind: {
                  task: tHistory("kind.task"),
                  job: tHistory("kind.job"),
                },
                taskStatus: taskStatusLabels,
              }}
            />

            <section className={PROJECTS_DETAIL_WORKSPACE_CLASS}>
              <h2 className="text-muted-foreground text-xs font-medium">
                {t("modules.title")}
              </h2>
              <ProjectModuleTiles
                calendarHref={`/projects/${project.id}/calendar`}
                socialHref={
                  socialBetaEnabled
                    ? `/projects/${project.id}/social`
                    : undefined
                }
                projectId={project.id}
                labels={{
                  calendar: {
                    title: t("modules.calendar.title"),
                    description: t("modules.calendar.description"),
                  },
                  comingSoon: t("modules.comingSoonList", {
                    areas: comingSoonAreas.join(", "),
                  }),
                  fileBrowser: {
                    title: t("modules.fileBrowser.title"),
                    description: t("modules.fileBrowser.description"),
                  },
                  imageStudio: {
                    title: t("modules.imageStudio.title"),
                    description: t("modules.imageStudio.description"),
                  },
                  socialMedia: {
                    title: t("modules.socialMedia.title"),
                    description: t("modules.socialMedia.description"),
                  },
                }}
              />
            </section>
          </div>
        </div>
      </ProjectBrandProvider>
    </ProjectWorkspaceShell>
  );
}
