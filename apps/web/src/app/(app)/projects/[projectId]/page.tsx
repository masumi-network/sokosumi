import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { ProjectDescription } from "@/app/projects/components/project-description";
import { ProjectDetailActions } from "@/app/projects/components/project-detail-actions";
import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";
import { ProjectJobsSection } from "@/app/projects/components/project-jobs-section";
import { ProjectStatsSummary } from "@/app/projects/components/project-stats-summary";
import { ProjectTasksSection } from "@/app/projects/components/project-tasks-section";
import { buildTaskStatusAbbreviationLabels } from "@/app/tasks/utils/task-status-labels";
import type { ProjectJobStatusCount } from "@/lib/clients/generated/core/types.gen";
import { projectService } from "@/lib/services/project.service";
import { formatShortDateTime } from "@/lib/utils/datetime";

const PROJECT_DETAIL_RESOURCE_LIMIT = 100;

type ProjectJobStatus = ProjectJobStatusCount["status"];

const JOB_STATUSES: ProjectJobStatus[] = [
  "started",
  "completed",
  "processing",
  "input_required",
  "result_pending",
  "failed",
  "payment_pending",
  "payment_failed",
  "refund_pending",
  "refund_resolved",
  "dispute_pending",
  "dispute_resolved",
];

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

  const [projectJobsResult, projectTasksResult, projectStatsResult] =
    await Promise.all([
      projectService.listProjectJobs(project.id, {
        limit: PROJECT_DETAIL_RESOURCE_LIMIT,
      }),
      projectService.listProjectTasks(project.id, {
        limit: PROJECT_DETAIL_RESOURCE_LIMIT,
      }),
      projectService.getProjectsStats([project.id]),
    ]);
  const projectStats = projectStatsResult.find(
    (entry) => entry.projectId === project.id,
  );

  if (!projectStats) {
    notFound();
  }

  const [t, statsT, locale] = await Promise.all([
    getTranslations("App.Projects.Detail"),
    getTranslations("App.Projects.list.stats"),
    getLocale(),
  ]);

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl pb-8 md:px-4">
        <ProjectDetailHeader
          projectName={project.name}
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

        <div className="mt-6 space-y-8">
          <ProjectStatsSummary
            stats={projectStats}
            labels={{
              tasks: statsT("tasks"),
              jobs: statsT("jobs"),
              taskStatusLabels: buildTaskStatusAbbreviationLabels((key) =>
                statsT(`taskStatusAbbreviations.${key}`),
              ),
              jobStatusLabels: Object.fromEntries(
                JOB_STATUSES.map((status) => [
                  status,
                  statsT(`jobStatusAbbreviations.${status}`),
                ]),
              ) as Record<ProjectJobStatus, string>,
            }}
          />

          <ProjectDescription
            title={t("description")}
            description={project.description}
            emptyLabel={t("emptyDescription")}
          />

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
      </div>
    </div>
  );
}
