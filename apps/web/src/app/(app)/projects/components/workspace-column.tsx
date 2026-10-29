import type { NotificationItem } from "@sokosumi/core-client";
import { getFormatter, getTranslations } from "next-intl/server";
import { projectService } from "@/lib/services/project.service";
import { formatNotificationTimeLabel } from "@/lib/utils/notification-time-label";

import { type ColumnProject, NeedsYouPanelList } from "./needs-you-panel-list";

/** Null when the feed failed: the panel says so instead of failing the page. */
export type PanelFeed<T> = Promise<T[] | null>;

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
