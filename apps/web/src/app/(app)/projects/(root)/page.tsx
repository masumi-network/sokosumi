import { getTranslations } from "next-intl/server";

import { ProjectsView } from "@/app/projects/components/projects-view";
import { PROJECTS_PAGE_LIMIT } from "@/app/projects/constants";
import type {
  ProjectJobStatusCount,
  ProjectStatsEntry,
  ProjectTaskStatusCount,
} from "@/lib/clients/generated/core/types.gen";
import { projectService } from "@/lib/services/project.service";

type ProjectTaskStatus = ProjectTaskStatusCount["status"];
type ProjectJobStatus = ProjectJobStatusCount["status"];

interface ProjectsPageProps {
  searchParams: Promise<{
    create?: string;
  }>;
}

const TASK_STATUSES: ProjectTaskStatus[] = [
  "DRAFT",
  "READY",
  "INPUT_REQUIRED",
  "AUTHENTICATION_REQUIRED",
  "OUT_OF_CREDITS",
  "CREDITS_TOPPED_UP",
  "RUNNING",
  "AWAITING_EXTERNAL",
  "COMPLETED",
  "FAILED",
  "CANCEL_REQUESTED",
  "CANCELED",
];

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

export const metadata = {
  title: "Projects",
};

export default async function ProjectsPage({
  searchParams,
}: ProjectsPageProps) {
  const { create } = await searchParams;
  const [t, projectsPage] = await Promise.all([
    getTranslations("App.Projects"),
    projectService.listProjects({ limit: PROJECTS_PAGE_LIMIT }),
  ]);
  const projectIds = projectsPage.projects.map((project) => project.id);
  const stats = await projectService.getProjectsStats(projectIds);
  const initialCreateProjectOpen = create === "true";

  return (
    <div className="w-full px-2">
      <ProjectsView
        key={projectsPage.projects
          .map((project) => `${project.id}:${project.updatedAt}`)
          .join("|")}
        projects={projectsPage.projects}
        nextCursor={projectsPage.pagination?.nextCursor ?? null}
        statsByProjectId={buildStatsByProjectId(stats)}
        initialCreateProjectOpen={initialCreateProjectOpen}
        createProjectModalResetKey={String(initialCreateProjectOpen)}
        labels={{
          newProject: t("empty.action"),
          empty: {
            title: t("empty.title"),
            description: t("empty.description"),
            action: t("empty.action"),
          },
          loadMore: t("list.loadMore"),
          loading: t("list.loading"),
          loadMoreError: t("Detail.errors.loadMore"),
          rowActions: {
            edit: t("Detail.actions.edit"),
            delete: t("Detail.actions.delete"),
          },
          deleteDialog: {
            title: t("Detail.deleteDialog.title"),
            description: t("Detail.deleteDialog.description"),
            confirm: t("Detail.deleteDialog.confirm"),
            cancel: t("Detail.deleteDialog.cancel"),
            error: t("Detail.errors.delete"),
          },
          stats: {
            tasks: t("list.stats.tasks"),
            jobs: t("list.stats.jobs"),
            taskStatusLabels: Object.fromEntries(
              TASK_STATUSES.map((status) => [
                status,
                t(`list.stats.taskStatusAbbreviations.${status}`),
              ]),
            ) as Record<ProjectTaskStatus, string>,
            jobStatusLabels: Object.fromEntries(
              JOB_STATUSES.map((status) => [
                status,
                t(`list.stats.jobStatusAbbreviations.${status}`),
              ]),
            ) as Record<ProjectJobStatus, string>,
          },
        }}
      />
    </div>
  );
}

function buildStatsByProjectId(stats: ProjectStatsEntry[]) {
  return Object.fromEntries(
    stats.map((entry) => [entry.projectId, entry]),
  ) as Record<string, ProjectStatsEntry>;
}
