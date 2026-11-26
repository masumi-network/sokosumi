import type {
  NotificationItem,
  ProjectActivityItem,
} from "@sokosumi/core-client";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { projectService } from "@/lib/services/project.service";
import { formatNotificationTimeLabel } from "@/lib/utils/notification-time-label";

import {
  type ColumnProject,
  type NeedsYouLead,
  NeedsYouPanelList,
} from "./needs-you-panel-list";
import { ProjectActivityRow } from "./project-activity-row";
import { WorkspaceColumnPanel } from "./workspace-column-panel";
import { WorkspaceColumnPanelSkeleton } from "./workspace-column-skeleton";

/** Null when the feed failed: the panel says so instead of failing the page. */
type PanelFeed<T> = Promise<T[] | null>;

/** A panel's feed failing leaves that panel saying so, not the page erroring. */
export function panelFeed<T>(promise: Promise<T[]>): PanelFeed<T> {
  return promise.catch((error: unknown) => {
    console.warn("Workspace column feed failed", { error });
    return null;
  });
}

/**
 * {@link panelFeed} for a read that starts in the page body. It waits for the
 * request first, so a link prefetch leaves the panel as a hole: an uncached
 * Core read started while a prefetch renders would cut that prefetch short.
 */
export function requestPanelFeed<T>(read: () => Promise<T[]>): PanelFeed<T> {
  // A prefetch ends with `connection()` rejected. That is no failed feed, so
  // it logs nothing.
  return connection().then(
    () => panelFeed(read()),
    () => null,
  );
}

interface WorkspaceColumnProps {
  /** Left out on the Projects list: Needs you lives on Home there. */
  needsYou?: PanelFeed<NotificationItem>;
  activity: PanelFeed<ProjectActivityItem>;
  projects: Record<string, ColumnProject>;
  /** The feeds hold one project's rows: Project Overview's right column. */
  projectScoped?: boolean;
}

/**
 * The Workspace column beside the Open grid: Needs you, then Recent
 * activity. Each panel streams behind its own boundary, so a slow feed holds
 * up neither the grid nor the other panel. Project Overview shows the same
 * two panels with feeds scoped to its project. The Projects list shows Recent
 * activity only; its Needs you sits on Home.
 */
export function WorkspaceColumn({
  needsYou,
  activity,
  projects,
  projectScoped = false,
}: WorkspaceColumnProps) {
  return (
    <div data-testid="workspace-column" className="flex min-w-0 flex-col gap-5">
      {needsYou ? (
        <Suspense
          fallback={
            <WorkspaceColumnPanelSkeleton testId="workspace-needs-you-loading" />
          }
        >
          <NeedsYouPanel feed={needsYou} projects={projects} />
        </Suspense>
      ) : null}
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

async function loadTimeLabel() {
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
 */
async function resolveRowProjects(
  rows: NotificationItem[],
  gridProjects: Record<string, ColumnProject>,
): Promise<Record<string, ColumnProject>> {
  const missingIds = [
    ...new Set(
      rows.flatMap((row) => {
        const projectId = notificationProjectId(row);
        return projectId && !gridProjects[projectId] ? [projectId] : [];
      }),
    ),
  ];
  const fetched = await Promise.all(
    missingIds.map((id) => projectService.getProjectById(id).catch(() => null)),
  );
  const byProjectId: Record<string, ColumnProject> = { ...gridProjects };
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
  quiet = false,
  leads = [],
}: {
  feed: PanelFeed<NotificationItem>;
  /** A read still in flight is awaited next to the feed, not after it. */
  projects:
    | WorkspaceColumnProps["projects"]
    | Promise<WorkspaceColumnProps["projects"]>;
  /** Home's quiet list instead of the column's panel. */
  quiet?: boolean;
  /** Rows above the notifications, such as your bot's failed reply. */
  leads?: NeedsYouLead[];
}) {
  // A hole in a link prefetch: the time labels read the clock, and a clock
  // read, or an uncached Core read, would cut that prefetch short.
  await connection();
  const [notifications, t, timeLabel, gridProjects] = await Promise.all([
    feed,
    getTranslations("App.Projects.column.needsYou"),
    loadTimeLabel(),
    projects,
  ]);
  const rows = notifications ?? [];
  const projectByNotificationId = await resolveRowProjects(rows, gridProjects);

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
      quiet={quiet}
      leads={leads.map((lead) => ({
        ...lead,
        time: lead.at ? timeLabel(lead.at) : "",
      }))}
    />
  );
}

export async function RecentActivityPanel({
  feed,
  projectScoped = false,
}: {
  feed: WorkspaceColumnProps["activity"];
  projectScoped?: boolean;
}) {
  // A hole in a link prefetch, as in Needs you above.
  await connection();
  const [items, t, timeLabel] = await Promise.all([
    feed,
    getTranslations("App.Projects.column.activity"),
    loadTimeLabel(),
  ]);

  return (
    <WorkspaceColumnPanel
      testId="workspace-activity"
      title={t("title")}
      empty={items ? t(projectScoped ? "emptyProject" : "empty") : t("error")}
      action={{ kind: "expand", label: t("showAll") }}
      rows={(items ?? []).map((item) => ({
        key: item.id,
        node: (
          <ProjectActivityRow item={item} time={timeLabel(item.createdAt)} />
        ),
      }))}
    />
  );
}
