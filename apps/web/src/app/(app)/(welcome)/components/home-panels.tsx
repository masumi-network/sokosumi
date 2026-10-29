import type {
  ProjectListItem,
  TaskActivitySummary,
} from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";
import {
  loadTimeLabel,
  type PanelFeed,
} from "@/app/projects/components/workspace-column";
import { WorkspaceColumnPanel } from "@/app/projects/components/workspace-column-panel";
import {
  WorkspaceColumnProjectAvatar,
  WorkspaceColumnRow,
} from "@/app/projects/components/workspace-column-row";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";

import type { TeamDayTask } from "./soko-bot-home-data";

/** Home's own slice of the Open projects, pinned first. */
export const HOME_PROJECT_LIMIT = 6;

/**
 * The Open view's first projects, pinned first, as compact rows beside Needs
 * you. The full list, with search and the other views, stays on `/projects`.
 */
export async function HomeProjectsPanel({
  feed,
}: {
  feed: PanelFeed<ProjectListItem>;
}) {
  const [projects, tProjects, t, timeLabel] = await Promise.all([
    feed,
    getTranslations("App.Projects"),
    getTranslations("App.Projects.column.projects"),
    loadTimeLabel(),
  ]);

  return (
    <WorkspaceColumnPanel
      testId="home-projects"
      title={tProjects("title")}
      empty={projects ? tProjects("empty.title") : t("error")}
      action={
        projects?.length === 0
          ? { label: tProjects("empty.action"), href: "/projects?create=true" }
          : { label: t("showAll"), href: "/projects" }
      }
      rows={(projects ?? []).map((project) => ({
        key: project.id,
        node: (
          <WorkspaceColumnRow
            leading={
              <WorkspaceColumnProjectAvatar
                name={project.name}
                logo={project.logo}
              />
            }
            title={project.name}
            detail={t("detail", {
              pinned: String(project.starredAt !== null),
              tasks: project.taskCount,
              jobs: project.jobCount,
            })}
            time={timeLabel(project.lastActivityAt ?? project.createdAt)}
            target={{ href: `/projects/${encodeURIComponent(project.id)}` }}
          />
        ),
      }))}
    />
  );
}

/**
 * Every task the workspace touched in the last 24 hours, project or not,
 * under the day's counts. It is the widest panel: task names run long.
 */
export async function HomeTeamDayPanel({
  feed,
  summary: summaryFeed,
}: {
  feed: PanelFeed<TeamDayTask>;
  summary: Promise<TaskActivitySummary | null>;
}) {
  const [tasks, summary, tStats, tStatus, t, timeLabel] = await Promise.all([
    feed,
    summaryFeed,
    getTranslations("App.Chat.Landing.stats"),
    getTranslations("App.Tasks.Filters.statusOptions"),
    getTranslations("App.Projects.column.teamDay"),
    loadTimeLabel(),
  ]);
  const stats = summary
    ? [
        summary.completed > 0
          ? tStats("completed", { count: summary.completed })
          : null,
        summary.workedMinutes >= 60
          ? tStats("workedHours", {
              hours: Math.round(summary.workedMinutes / 60),
            })
          : summary.workedMinutes > 0
            ? tStats("worked", { minutes: summary.workedMinutes })
            : null,
        summary.createdByOtherHumans > 0
          ? tStats("byTeammates", { count: summary.createdByOtherHumans })
          : null,
      ].filter((stat): stat is string => stat !== null)
    : [];

  return (
    <WorkspaceColumnPanel
      testId="home-team-day"
      title={[tStats("recent"), ...stats].join(" · ")}
      empty={tasks ? t("empty") : t("error")}
      rows={(tasks ?? []).map((task) => ({
        key: task.id,
        node: (
          <WorkspaceColumnRow
            leading={
              <TaskStatusBadge
                status={task.status}
                label={tStatus(task.status)}
                showLabel={false}
                className="border-0 bg-transparent p-0"
              />
            }
            title={task.name}
            detail={task.who}
            time={timeLabel(task.updatedAt)}
            target={{ href: `/tasks/${encodeURIComponent(task.id)}` }}
          />
        ),
      }))}
    />
  );
}
