import type {
  NotificationItem,
  ProjectActivityItem,
} from "@sokosumi/core-client";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { projectService } from "@/lib/services/project.service";
import { getNotificationHref } from "@/lib/utils/notification-href";
import { formatNotificationTimeLabel } from "@/lib/utils/notification-time-label";

import { type ColumnProject, NeedsYouPanelList } from "./needs-you-panel-list";
import { WorkspaceColumnPanel } from "./workspace-column-panel";
import {
  WorkspaceColumnProjectAvatar,
  WorkspaceColumnRow,
} from "./workspace-column-row";
import { WorkspaceColumnPanelSkeleton } from "./workspace-column-skeleton";

/** Null when the feed failed: the panel says so instead of failing the page. */
export type PanelFeed<T> = Promise<T[] | null>;

/** A panel's feed failing leaves that panel saying so, not the page erroring. */
export function panelFeed<T>(promise: Promise<T[]>): PanelFeed<T> {
  return promise.catch((error: unknown) => {
    console.warn("Workspace column feed failed", { error });
    return null;
  });
}

interface WorkspaceColumnProps {
  needsYou: PanelFeed<NotificationItem>;
  activity: PanelFeed<ProjectActivityItem>;
  projects: Record<string, ColumnProject>;
  /** The feeds hold one project's rows: Project Overview's right column. */
  projectScoped?: boolean;
}

/**
 * The Workspace column beside the Open grid: Needs you, then Recent
 * activity. Each panel streams behind its own boundary, so a slow feed holds
 * up neither the grid nor the other panel. Project Overview shows the same
 * two panels with feeds scoped to its project.
 */
export function WorkspaceColumn({
  needsYou,
  activity,
  projects,
  projectScoped = false,
}: WorkspaceColumnProps) {
  return (
    <div data-testid="workspace-column" className="flex min-w-0 flex-col gap-5">
      <Suspense
        fallback={
          <WorkspaceColumnPanelSkeleton testId="workspace-needs-you-loading" />
        }
      >
        <NeedsYouPanel
          feed={needsYou}
          projects={Promise.resolve(
            Object.entries(projects).map(([id, project]) => ({
              id,
              ...project,
            })),
          )}
        />
      </Suspense>
      <Suspense
        fallback={
          <WorkspaceColumnPanelSkeleton testId="workspace-activity-loading" />
        }
      >
        <RecentActivityPanel feed={activity} projectScoped={projectScoped} />
      </Suspense>
    </div>
  );
}

/** "5 minutes ago" for every panel row, the Notification Center's wording. */
export async function loadTimeLabel() {
  const [formatter, tCenter] = await Promise.all([
    getFormatter(),
    getTranslations("Components.NotificationCenter"),
  ]);
  const now = new Date();
  const justNow = tCenter("justNow");
  // A string too: the generated transformer leaves a union row's `createdAt`
  // as the wire's ISO string, as it does for the history feed.
  return (timestamp: string | Date) =>
    formatNotificationTimeLabel(timestamp, now, formatter, justNow);
}

function notificationProjectId(notification: NotificationItem): string | null {
  const projectId = notification.metadata?.projectId;
  return typeof projectId === "string" ? projectId : null;
}

/**
 * Each row's project, by notification id. The grid's page answers most of
 * them; a project it does not hold (a later page, or filtered out by `q`) is
 * read on its own, so a row never loses its avatar to the grid's filter.
 * On Home the "grid" is the first Open projects it already loaded.
 */
async function resolveRowProjects(
  rows: NotificationItem[],
  knownProjects: Record<string, ColumnProject>,
): Promise<Record<string, ColumnProject>> {
  const missingIds = [
    ...new Set(
      rows.flatMap((row) => {
        const projectId = notificationProjectId(row);
        return projectId && !knownProjects[projectId] ? [projectId] : [];
      }),
    ),
  ];
  const fetched = await Promise.all(
    missingIds.map((id) => projectService.getProjectById(id).catch(() => null)),
  );
  const byProjectId: Record<string, ColumnProject> = { ...knownProjects };
  for (const project of fetched) {
    if (project) {
      byProjectId[project.id] = { name: project.name, logo: project.logo };
    }
  }

  return Object.fromEntries(
    rows.flatMap((row) => {
      const projectId = notificationProjectId(row);
      const project = projectId ? byProjectId[projectId] : undefined;
      return project ? [[row.id, project]] : [];
    }),
  );
}

export async function NeedsYouPanel({
  feed,
  projects,
}: {
  feed: PanelFeed<NotificationItem>;
  /** Projects already loaded for the page, for their avatars; awaited beside
   * the feed, so the slower of the two sets the pace. */
  projects: PanelFeed<{ id: string; name: string; logo: string | null }>;
}) {
  const [notifications, loaded, t, timeLabel] = await Promise.all([
    feed,
    projects,
    getTranslations("App.Projects.column.needsYou"),
    loadTimeLabel(),
  ]);
  const rows = notifications ?? [];
  const projectByNotificationId = await resolveRowProjects(
    rows,
    Object.fromEntries(
      (loaded ?? []).map((project) => [
        project.id,
        { name: project.name, logo: project.logo },
      ]),
    ),
  );

  return (
    <NeedsYouPanelList
      notifications={rows}
      timeLabels={Object.fromEntries(
        rows.map((row) => [row.id, timeLabel(row.createdAt)]),
      )}
      projects={projectByNotificationId}
      labels={{
        title: t("title"),
        empty: notifications ? t("empty") : t("error"),
        showAll: t("showAll"),
      }}
    />
  );
}

function activityHref(item: ProjectActivityItem): string {
  switch (item.kind) {
    case "task":
      return getNotificationHref({
        kind: "TASK",
        referenceId: item.taskId,
        metadata: null,
      });
    case "job":
      return getNotificationHref({
        kind: "JOB",
        referenceId: item.jobId,
        metadata: { agentId: item.agentId },
      });
    case "project":
      return getNotificationHref({
        kind: "PROJECT",
        referenceId: item.project.id,
        metadata: null,
      });
  }
}

export async function RecentActivityPanel({
  feed,
  projectScoped = false,
}: {
  feed: WorkspaceColumnProps["activity"];
  projectScoped?: boolean;
}) {
  const [items, t, timeLabel] = await Promise.all([
    feed,
    getTranslations("App.Projects.column.activity"),
    loadTimeLabel(),
  ]);

  function describe(item: ProjectActivityItem) {
    switch (item.kind) {
      case "task":
        return {
          title: item.title,
          event: t("task", { status: item.status ?? "COMMENT" }),
        };
      case "job":
        return {
          title: item.title ?? t("untitledJob"),
          event: t("job", { status: item.status }),
        };
      case "project":
        return {
          title: item.project.name,
          event: t("project", { event: item.event }),
        };
    }
  }

  return (
    <WorkspaceColumnPanel
      testId="workspace-activity"
      title={t("title")}
      empty={items ? t(projectScoped ? "emptyProject" : "empty") : t("error")}
      rows={(items ?? []).map((item) => {
        const { title, event } = describe(item);
        return {
          key: item.id,
          node: (
            <WorkspaceColumnRow
              leading={
                <WorkspaceColumnProjectAvatar
                  name={item.project.name}
                  logo={item.project.logo}
                />
              }
              title={title}
              detail={
                item.kind === "project"
                  ? event
                  : t("detail", { project: item.project.name, event })
              }
              time={timeLabel(item.createdAt)}
              target={{ href: activityHref(item) }}
            />
          ),
        };
      })}
    />
  );
}
