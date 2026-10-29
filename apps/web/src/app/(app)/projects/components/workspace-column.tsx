import type {
  NotificationItem,
  ProjectActivityItem,
} from "@sokosumi/core-client";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getNotificationHref } from "@/lib/utils/notification-href";
import { formatNotificationTimeLabel } from "@/lib/utils/notification-time-label";

import {
  NeedsYouPanelList,
  type NeedsYouProject,
} from "./needs-you-panel-list";
import { ProjectAvatar } from "./project-avatar";
import { WorkspaceColumnPanel } from "./workspace-column-panel";
import { WorkspaceColumnRow } from "./workspace-column-row";
import { WorkspaceColumnPanelSkeleton } from "./workspace-column-skeleton";

/** Null when the feed failed: the panel says so instead of failing the page. */
type PanelFeed<T> = Promise<T[] | null>;

interface WorkspaceColumnProps {
  needsYou: PanelFeed<NotificationItem>;
  activity: PanelFeed<ProjectActivityItem>;
  projects: Record<string, NeedsYouProject>;
}

/**
 * The Workspace column beside the Open grid: Needs you, then Recent
 * activity. Each panel streams behind its own boundary, so a slow feed holds
 * up neither the grid nor the other panel.
 */
export function WorkspaceColumn({
  needsYou,
  activity,
  projects,
}: WorkspaceColumnProps) {
  return (
    <div data-testid="workspace-column" className="flex min-w-0 flex-col gap-5">
      <Suspense
        fallback={
          <WorkspaceColumnPanelSkeleton testId="workspace-needs-you-loading" />
        }
      >
        <NeedsYouPanel feed={needsYou} projects={projects} />
      </Suspense>
      <Suspense
        fallback={
          <WorkspaceColumnPanelSkeleton testId="workspace-activity-loading" />
        }
      >
        <RecentActivityPanel feed={activity} />
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

export async function NeedsYouPanel({
  feed,
  projects,
}: {
  feed: WorkspaceColumnProps["needsYou"];
  projects: WorkspaceColumnProps["projects"];
}) {
  const [notifications, t, timeLabel] = await Promise.all([
    feed,
    getTranslations("App.Projects.column.needsYou"),
    loadTimeLabel(),
  ]);
  const rows = notifications ?? [];

  return (
    <NeedsYouPanelList
      notifications={rows}
      timeLabels={Object.fromEntries(
        rows.map((row) => [row.id, timeLabel(row.createdAt)]),
      )}
      projects={projects}
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
}: {
  feed: WorkspaceColumnProps["activity"];
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
      empty={items ? t("empty") : t("error")}
      action={{ kind: "expand", label: t("showAll") }}
      rows={(items ?? []).map((item) => {
        const { title, event } = describe(item);
        return {
          key: item.id,
          node: (
            <WorkspaceColumnRow
              leading={
                <ProjectAvatar
                  name={item.project.name}
                  logo={item.project.logo}
                  className="size-4 rounded-sm"
                  fallbackClassName="rounded-sm text-2xs"
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
