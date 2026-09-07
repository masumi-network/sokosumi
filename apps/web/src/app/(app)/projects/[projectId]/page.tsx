import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import {
  ProjectBrandCard,
  ProjectBrandProvider,
} from "@/app/projects/components/project-brand-card";
import { ProjectBriefing } from "@/app/projects/components/project-briefing";
import { ProjectDetailActions } from "@/app/projects/components/project-detail-actions";
import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";
import { ProjectLatestUpdate } from "@/app/projects/components/project-latest-update";
import { ProjectMemoryRow } from "@/app/projects/components/project-memory-row";
import { ProjectModuleTiles } from "@/app/projects/components/project-module-tiles";
import { ProjectNeedsAttentionSection } from "@/app/projects/components/project-needs-attention-section";
import {
  PROJECTS_DETAIL_SHELL_CLASS,
  PROJECTS_DETAIL_TOP_CLASS,
  PROJECTS_DETAIL_WORKSPACE_CLASS,
} from "@/app/projects/constants";
import { buildTaskStatusLabels } from "@/app/tasks/utils/task-status-labels";
import { getSession } from "@/lib/auth/auth.server";
import { isBetaAccessEmail } from "@/lib/beta-access";
import { projectService } from "@/lib/services/project.service";
import { formatShortDateTime } from "@/lib/utils/datetime";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const [session, { projectId }] = await Promise.all([getSession(), params]);
  const project = await projectService.getProjectById(projectId);

  if (!project) {
    notFound();
  }

  const [attention, t, tHistory, tListStats, tTaskFilters, locale] =
    await Promise.all([
      projectService.getProjectNeedsAttention(project.id),
      getTranslations("App.Projects.Detail"),
      getTranslations("App.History.Row"),
      getTranslations("App.Projects.list.stats"),
      getTranslations("App.Tasks.Filters"),
      getLocale(),
    ]);

  const taskStatusLabels = buildTaskStatusLabels((key) =>
    tTaskFilters(`statusOptions.${key}`),
  );

  return (
    <div className={PROJECTS_DETAIL_SHELL_CLASS}>
      <div className={PROJECTS_DETAIL_TOP_CLASS}>
        <ProjectDetailHeader
          projectName={project.name}
          projectLogo={project.logo}
          websiteUrl={project.websiteUrl}
          backLabel={t("back")}
          metadata={[
            {
              label: t("header.updated"),
              value: formatShortDateTime(project.updatedAt, locale),
            },
            {
              label: t("header.created"),
              value: formatShortDateTime(project.createdAt, locale),
            },
          ]}
          actions={
            <ProjectDetailActions
              projectId={project.id}
              labels={{
                moreActions: t("actions.moreActions"),
                edit: t("actions.edit"),
                delete: t("actions.delete"),
                deleteDialog: {
                  title: t("deleteDialog.title"),
                  description: t("deleteDialog.description"),
                  confirm: t("deleteDialog.confirm"),
                  cancel: t("deleteDialog.cancel"),
                  error: t("errors.delete"),
                },
              }}
            />
          }
        />

        <ProjectBrandProvider
          key={project.designMd?.url ?? "project-brand-empty"}
          projectId={project.id}
          initialDesignMd={project.designMd}
          websiteUrl={project.websiteUrl}
        >
          <div className="mt-6 grid grid-cols-1 gap-8 xl:grid-cols-3">
            {project.latestUpdate ? (
              <div className="xl:col-span-3">
                <ProjectLatestUpdate
                  title={t("latestUpdate")}
                  content={project.latestUpdate.content}
                  showMoreLabel={t("showMore")}
                  showLessLabel={t("showLess")}
                />
              </div>
            ) : null}

            <div className="xl:col-span-2">
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

            <ProjectBrandCard
              projectId={project.id}
              projectName={project.name}
              logo={project.logo}
              websiteUrl={project.websiteUrl}
            />

            <div className="xl:col-span-2">
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
                  locale,
                }}
              />
            </div>

            <ProjectMemoryRow
              projectId={project.id}
              contextMd={project.contextMd}
              contextMdUpdating={project.contextMdUpdating}
              memoryEnabled={project.memoryEnabled}
              memoryModel={project.memoryModel}
            />
          </div>
        </ProjectBrandProvider>
      </div>

      <section className={PROJECTS_DETAIL_WORKSPACE_CLASS}>
        <h2 className="text-muted-foreground text-xs font-medium">
          {t("modules.title")}
        </h2>
        <ProjectModuleTiles
          calendarHref={
            isBetaAccessEmail(session?.user.email)
              ? `/projects/${project.id}/calendar`
              : undefined
          }
          projectId={project.id}
          labels={{
            calendar: {
              title: t("modules.calendar.title"),
              description: t("modules.calendar.description"),
            },
            comingSoon: t("modules.comingSoon"),
            seo: {
              title: t("modules.seo.title"),
              description: t("modules.seo.description"),
            },
            socialMedia: {
              title: t("modules.socialMedia.title"),
              description: t("modules.socialMedia.description"),
            },
            email: {
              title: t("modules.email.title"),
              description: t("modules.email.description"),
            },
            paidAdvertising: {
              title: t("modules.paidAdvertising.title"),
              description: t("modules.paidAdvertising.description"),
            },
            content: {
              title: t("modules.content.title"),
              description: t("modules.content.description"),
            },
            pr: {
              title: t("modules.pr.title"),
              description: t("modules.pr.description"),
            },
            fileBrowser: {
              title: t("modules.fileBrowser.title"),
              description: t("modules.fileBrowser.description"),
            },
          }}
        />
      </section>
    </div>
  );
}
