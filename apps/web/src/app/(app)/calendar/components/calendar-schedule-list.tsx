"use client";

import { parseTaskScheduleMetadata } from "@sokosumi/utils";
import { Pencil } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { AssigneeAvatar } from "@/app/tasks/components/assignee-avatar";
import { TaskDetailLink } from "@/app/tasks/components/task-detail-link";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import type { TaskAssigneeView } from "@/app/tasks/types/task-board";
import {
  computeScheduleTitleInfo,
  formatScheduleTitle,
  type ScheduleTitleTranslateFn,
} from "@/components/schedules/format";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UserProfileAvatar } from "@/components/user/user-profile-avatar";
import type {
  TaskListItem,
  WorkspaceCalendarSource,
} from "@/lib/clients/generated/core";
import type { DateTimeFormatter } from "@/lib/schedules/cron";
import { SourceMarker } from "./source-marker";

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
  formatter: DateTimeFormatter,
): string | null {
  const scheduleMetadata = parseTaskScheduleMetadata(metadata);
  if (!scheduleMetadata) {
    return null;
  }

  return formatScheduleTitle(
    computeScheduleTitleInfo(
      {
        scheduleType: scheduleMetadata.mode === "once" ? "ONE_TIME" : "CRON",
        cron:
          scheduleMetadata.mode === "recurring" ? scheduleMetadata.expr : null,
        timezone:
          scheduleMetadata.mode === "recurring"
            ? scheduleMetadata.timezone
            : "UTC",
      },
      formatter,
    ),
    t,
  );
}

function findSource(
  task: TaskListItem,
  sources: WorkspaceCalendarSource[],
): WorkspaceCalendarSource | undefined {
  const sourceId = task.projectId
    ? `project:${task.projectId}`
    : `workspace:${task.workspace.id}`;

  return sources.find((source) => source.sourceId === sourceId);
}

function toAssigneeView(
  assignee: TaskListItem["assignee"],
  fallbackName: string,
): TaskAssigneeView | null {
  if (!assignee) {
    return null;
  }

  if (assignee.type === "sokoBot") {
    return {
      id: assignee.id,
      name: assignee.sokoBot.name?.trim() || fallbackName,
      image: assignee.sokoBot.avatarImageUrl,
      kind: "sokoBot",
      avatarSeed: assignee.sokoBot.avatarSeed,
    };
  }

  if (assignee.type === "user") {
    return {
      id: assignee.id,
      name: assignee.user.name,
      image: assignee.user.image,
      kind: "user",
    };
  }

  return {
    id: assignee.id,
    name: assignee.coworker.name,
    image: assignee.coworker.image,
    slug: assignee.coworker.slug,
    kind: "coworker",
  };
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
  const tTasks = useTranslations("App.Tasks");
  const formatter = useFormatter();

  return (
    <div className="flex flex-col gap-4">
      {tasks.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tasks.map((task) => {
            const recurrenceLabel = getRecurrenceLabel(
              task.metadata,
              tSchedule,
              formatter,
            );
            const nextRunLabel = task.nextRunAt
              ? formatter.dateTime(task.nextRunAt, "dateTime", { timeZone })
              : null;
            const source = findSource(task, sources);
            const sourceName = source?.displayName ?? t("source.WORKSPACE");
            const assignee = toAssigneeView(
              task.assignee,
              tTasks("personalAssistant"),
            );
            const peopleNames = [assignee?.name, task.owner.name]
              .filter((name): name is string => Boolean(name?.trim()))
              .join(", ");

            return (
              <Card
                className="gap-3 py-4"
                data-testid="calendar-schedule-row"
                key={task.id}
              >
                <CardHeader className="flex items-start justify-between gap-3 px-4">
                  <div className="flex min-w-0 flex-col items-start gap-2">
                    {peopleNames ? (
                      <>
                        <span
                          aria-hidden
                          className="-space-x-2 flex shrink-0 items-center"
                          data-testid="calendar-schedule-people"
                          title={peopleNames}
                        >
                          {assignee ? (
                            <AssigneeAvatar assignee={assignee} size="lg" />
                          ) : null}
                          <UserProfileAvatar
                            className="z-10"
                            image={task.owner.image}
                            name={task.owner.name}
                            size="lg"
                          />
                        </span>
                        <span className="sr-only">{peopleNames}</span>
                      </>
                    ) : null}
                    <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                      <SourceMarker
                        decorative
                        size="size-4"
                        source={source}
                        sourceName={sourceName}
                      />
                      <span className="line-clamp-1">{sourceName}</span>
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <CardTitle>
                        <TaskDetailLink
                          className="text-foreground line-clamp-2 text-sm font-medium hover:underline"
                          href={`/tasks/${task.id}`}
                          title={t("schedules.openTask")}
                        >
                          {task.name}
                        </TaskDetailLink>
                      </CardTitle>
                      {recurrenceLabel ? (
                        <CardDescription className="line-clamp-1 text-xs">
                          {recurrenceLabel}
                        </CardDescription>
                      ) : null}
                    </div>
                  </div>
                  <TaskStatusBadge
                    className="w-fit shrink-0 rounded-sm"
                    label={t(`status.${task.status}`)}
                    status={task.status}
                  />
                </CardHeader>
                <CardFooter className="mt-auto items-end justify-between gap-3 px-4 text-xs">
                  <span className="text-muted-foreground tabular-nums">
                    {nextRunLabel
                      ? `${t("schedules.nextRun")}: ${nextRunLabel}`
                      : t("schedules.noNextRun")}
                  </span>
                  {task.ownerId === currentUserId ? (
                    <Button
                      aria-label={t("schedules.edit")}
                      className="-my-2 -mr-2 shrink-0"
                      onClick={() => onEditSchedule(task.id)}
                      size="icon"
                      variant="ghost"
                    >
                      <Pencil aria-hidden />
                    </Button>
                  ) : null}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="text-muted-foreground border-border flex items-center justify-center rounded-xl border py-16 text-sm">
          {t("empty.schedulesTitle")}
        </div>
      )}
      {hasMore ? (
        <div className="flex justify-center">
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
      {loadMoreError ? (
        <p className="text-destructive text-sm" role="alert">
          {t("pagination.error")}
        </p>
      ) : null}
    </div>
  );
}
