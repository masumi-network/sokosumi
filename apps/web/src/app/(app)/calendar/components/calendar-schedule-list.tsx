"use client";

import { parseTaskScheduleMetadata } from "@sokosumi/utils";
import { Pencil } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { TaskDetailLink } from "@/app/tasks/components/task-detail-link";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import {
  computeScheduleTitleInfo,
  formatScheduleTitle,
  type ScheduleTitleTranslateFn,
} from "@/components/schedules/format";
import { Button } from "@/components/ui/button";
import type {
  TaskListItem,
  WorkspaceCalendarSource,
} from "@/lib/clients/generated/core";

interface CalendarScheduleListProps {
  currentUserId: string | null;
  hasMore: boolean;
  isLoading: boolean;
  loadMoreError: boolean;
  onEditSchedule: (taskId: string) => void;
  onLoadMore: () => void;
  sources: WorkspaceCalendarSource[];
  tasks: TaskListItem[];
  timeZone: string;
}

function getRecurrenceLabel(
  metadata: string | null,
  t: ScheduleTitleTranslateFn,
): string | null {
  const scheduleMetadata = parseTaskScheduleMetadata(metadata);
  if (!scheduleMetadata) {
    return null;
  }

  return formatScheduleTitle(
    computeScheduleTitleInfo({
      scheduleType: scheduleMetadata.mode === "once" ? "ONE_TIME" : "CRON",
      cron:
        scheduleMetadata.mode === "recurring" ? scheduleMetadata.expr : null,
      timezone:
        scheduleMetadata.mode === "recurring"
          ? scheduleMetadata.timezone
          : "UTC",
    }),
    t,
  );
}

function getSourceName(
  task: TaskListItem,
  sources: WorkspaceCalendarSource[],
): string | null {
  const sourceId = task.projectId
    ? `project:${task.projectId}`
    : `workspace:${task.workspace.id}`;

  return (
    sources.find((source) => source.sourceId === sourceId)?.displayName ?? null
  );
}

export function CalendarScheduleList({
  currentUserId,
  hasMore,
  isLoading,
  loadMoreError,
  onEditSchedule,
  onLoadMore,
  sources,
  tasks,
  timeZone,
}: CalendarScheduleListProps) {
  const t = useTranslations("App.Calendar");
  const tSchedule = useTranslations("App.Tasks.Schedule");
  const formatter = useFormatter();

  return (
    <div className="bg-card-background border-border -mx-4 overflow-hidden rounded-none border-0 md:mx-0 md:rounded-xl md:border">
      {tasks.length > 0 ? (
        <div className="divide-border divide-y">
          {tasks.map((task) => {
            const recurrenceLabel = getRecurrenceLabel(
              task.metadata,
              tSchedule,
            );
            const nextRunLabel = task.nextRunAt
              ? formatter.dateTime(task.nextRunAt, "dateTime", { timeZone })
              : null;
            const sourceName = getSourceName(task, sources);

            return (
              <div
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                data-testid="calendar-schedule-row"
                key={task.id}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <TaskDetailLink
                    className="text-foreground line-clamp-1 text-sm font-medium hover:underline"
                    href={`/tasks/${task.id}`}
                    title={t("schedules.openTask")}
                  >
                    {task.name}
                  </TaskDetailLink>
                  {recurrenceLabel ? (
                    <p className="text-muted-foreground line-clamp-1 text-xs">
                      {recurrenceLabel}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs sm:gap-4">
                  <TaskStatusBadge
                    className="w-fit shrink-0 rounded-sm"
                    label={t(`status.${task.status}`)}
                    status={task.status}
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-muted-foreground tabular-nums">
                      {nextRunLabel
                        ? `${t("schedules.nextRun")}: ${nextRunLabel}`
                        : t("schedules.noNextRun")}
                    </span>
                    <span className="text-muted-foreground line-clamp-1">
                      {sourceName ?? t("source.WORKSPACE")}
                    </span>
                  </div>
                  {task.ownerId === currentUserId ? (
                    <Button
                      aria-label={t("schedules.edit")}
                      onClick={() => onEditSchedule(task.id)}
                      size="icon"
                      variant="ghost"
                    >
                      <Pencil aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {hasMore ? (
            <div className="flex justify-center py-3">
              <Button
                disabled={isLoading}
                onClick={onLoadMore}
                size="sm"
                variant="outline"
              >
                {t("schedules.loadMore")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-muted-foreground flex items-center justify-center py-16 text-sm">
          {t("empty.schedulesTitle")}
        </div>
      )}
      {loadMoreError ? (
        <p className="text-destructive px-4 py-3 text-sm" role="alert">
          {t("pagination.error")}
        </p>
      ) : null}
    </div>
  );
}
