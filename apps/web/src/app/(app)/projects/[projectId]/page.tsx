import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import {
  ProjectBrandCard,
  ProjectBrandProvider,
} from "@/app/projects/components/project-brand-card";
import { ProjectBriefing } from "@/app/projects/components/project-briefing";
import { ProjectDetailActions } from "@/app/projects/components/project-detail-actions";
import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";
import { ProjectJobsSection } from "@/app/projects/components/project-jobs-section";
import { ProjectMemoryRow } from "@/app/projects/components/project-memory-row";
import { ProjectModuleTiles } from "@/app/projects/components/project-module-tiles";
import { ProjectTasksSection } from "@/app/projects/components/project-tasks-section";
import {
  PROJECTS_DETAIL_SHELL_CLASS,
  PROJECTS_DETAIL_TOP_CLASS,
  PROJECTS_DETAIL_WORKSPACE_CLASS,
} from "@/app/projects/constants";
import { getSession } from "@/lib/auth/auth.server";
import { isBetaAccessEmail } from "@/lib/beta-access";
import { projectService } from "@/lib/services/project.service";
import { formatShortDateTime } from "@/lib/utils/datetime";

const PROJECT_DETAIL_RESOURCE_LIMIT = 100;

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

  const [projectJobsResult, projectTasksResult] = await Promise.all([
    projectService.listProjectJobs(project.id, {
      limit: PROJECT_DETAIL_RESOURCE_LIMIT,
    }),
    projectService.listProjectTasks(project.id, {
      limit: PROJECT_DETAIL_RESOURCE_LIMIT,
    }),
  ]);

  const [t, locale] = await Promise.all([
    getTranslations("App.Projects.Detail"),
    getLocale(),
  ]);

  return (
    <div className={PROJECTS_DETAIL_SHELL_CLASS}>
      <div className={PROJECTS_DETAIL_TOP_CLASS}>
        <ProjectDetailHeader
          calendarLabel={t("navigation.calendar")}
          projectName={project.name}
          projectId={project.id}
          projectLogo={project.logo}
          websiteUrl={project.websiteUrl}
          backLabel={t("back")}
          navigationLabel={t("navigation.label")}
          overviewLabel={t("navigation.overview")}
          selectedView="overview"
          showCalendar={isBetaAccessEmail(session?.user.email)}
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
          <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="bg-muted/30 border-border/50 rounded-none border p-4 md:rounded-xl xl:col-span-2">
              <ProjectBriefing
                title={t("briefing")}
                briefing={project.briefing}
                emptyLabel={t("emptyBriefing")}
                emptyActionLabel={t("writeBriefing")}
                editHref={`/projects/${project.id}/edit`}
                editLabel={t("editBriefing")}
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

            <div className="bg-muted/30 border-border/50 rounded-none border p-4 md:rounded-xl xl:col-span-2">
              <ProjectTasksSection
                projectId={project.id}
                tasks={projectTasksResult.tasks}
                labels={{
                  title: t("tasks.title"),
                  empty: t("tasks.empty"),
                  add: t("tasks.add"),
                  remove: t("tasks.remove"),
                  pickerTitle: t("tasks.pickerTitle"),
                  pickerDescription: t("tasks.pickerDescription"),
                  pickerSearchPlaceholder: t("tasks.pickerSearchPlaceholder"),
                  pickerEmpty: t("tasks.pickerEmpty"),
                  pickerLoading: t("tasks.pickerLoading"),
                  pickerError: t("tasks.pickerError"),
                  confirmRemove: t("actions.confirmRemoveTask"),
                  cancel: t("deleteDialog.cancel"),
                  errors: {
                    add: t("errors.addTask"),
                    remove: t("errors.removeTask"),
                  },
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

            <div className="bg-muted/30 border-border/50 rounded-none border p-4 md:rounded-xl xl:col-span-3">
              <ProjectJobsSection
                projectId={project.id}
                jobs={projectJobsResult.jobs}
                labels={{
                  title: t("jobs.title"),
                  empty: t("jobs.empty"),
                  add: t("jobs.add"),
                  remove: t("jobs.remove"),
                  pickerTitle: t("jobs.pickerTitle"),
                  pickerDescription: t("jobs.pickerDescription"),
                  pickerSearchPlaceholder: t("jobs.pickerSearchPlaceholder"),
                  pickerEmpty: t("jobs.pickerEmpty"),
                  pickerLoading: t("jobs.pickerLoading"),
                  pickerError: t("jobs.pickerError"),
                  confirmRemove: t("actions.confirmRemoveJob"),
                  cancel: t("deleteDialog.cancel"),
                  untitled: t("jobs.untitled"),
                  errors: {
                    add: t("errors.addJob"),
                    remove: t("errors.removeJob"),
                  },
                }}
              />
            </div>
          </div>
        </ProjectBrandProvider>
      </div>

      <section className={PROJECTS_DETAIL_WORKSPACE_CLASS}>
        <h2 className="text-muted-foreground text-xs font-medium">
          {t("modules.title")}
        </h2>
        <ProjectModuleTiles
          projectId={project.id}
          labels={{
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
