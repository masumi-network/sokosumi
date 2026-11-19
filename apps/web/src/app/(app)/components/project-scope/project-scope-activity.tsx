"use client";

import type { ProjectActivityItem } from "@sokosumi/core-client";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ProjectActivityRow } from "@/app/projects/components/project-activity-row";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchScopeList } from "@/lib/project-scope-list.client";
import { useNotificationTimeFormatter } from "@/lib/utils/notification-time";
import { useWorkspaceScope } from "./use-scope-projects";

export function ProjectScopeActivity({
  onNavigate,
}: {
  onNavigate: () => void;
}) {
  const scope = useWorkspaceScope();
  const t = useTranslations("App.Projects.column.activity");
  const timeLabel = useNotificationTimeFormatter();
  const activity = useQuery({
    queryKey: ["project-scope-activity", scope?.userId, scope?.organizationId],
    queryFn: scope
      ? ({ signal }) =>
          fetchScopeList<ProjectActivityItem[]>(
            "/api/project-scope/activity",
            scope,
            signal,
          )
      : skipToken,
    // A reopened picker should include new events and omit newly hidden projects.
    gcTime: 0,
    retry: false,
  });

  return (
    <section
      aria-label={t("title")}
      aria-busy={activity.isPending || undefined}
      className="flex min-h-0 min-w-0 flex-col border-s"
    >
      <h2 className="text-muted-foreground flex min-h-10 shrink-0 items-center border-b px-3 text-sm font-medium">
        {t("title")}
      </h2>
      {activity.isPending ? (
        <Skeleton aria-hidden className="mx-4 my-3 h-4 w-2/3" />
      ) : activity.isSuccess && activity.data.length > 0 ? (
        <ul className="app-scrollbar min-h-0 max-h-96 overflow-y-auto overscroll-contain scroll-py-1.5 p-1.5">
          {activity.data.map((item) => (
            <li key={item.id}>
              <ProjectActivityRow
                inProjectPicker
                item={item}
                time={timeLabel(item.createdAt)}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p
          role="status"
          className="text-muted-foreground overflow-y-auto px-4 py-3 text-sm"
        >
          {t(activity.isError ? "error" : "empty")}
        </p>
      )}
    </section>
  );
}
