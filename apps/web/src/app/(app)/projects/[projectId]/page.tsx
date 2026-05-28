import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { ProjectDescription } from "@/app/projects/components/project-description";
import { ProjectDetailActions } from "@/app/projects/components/project-detail-actions";
import { ProjectDetailHeader } from "@/app/projects/components/project-detail-header";
import { ProjectJobsSection } from "@/app/projects/components/project-jobs-section";
import { ProjectTasksSection } from "@/app/projects/components/project-tasks-section";
import { projectService } from "@/lib/services/project.service";
import { formatShortDateTime } from "@/lib/utils/datetime";

const PROJECT_DETAIL_RESOURCE_LIMIT = 100;

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
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-4xl px-4 pb-8">
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
