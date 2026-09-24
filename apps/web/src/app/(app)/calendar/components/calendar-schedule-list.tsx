"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { AssigneeAvatar } from "@/app/tasks/components/assignee-avatar";
import { TaskScheduleStateBadge } from "@/app/tasks/components/task-schedule-state-badge";
import type { TaskAssigneeView } from "@/app/tasks/types/task-board";
import {
  formatTaskScheduleRule,
  taskScheduleAssigneeId,
  taskSchedulePath,
} from "@/app/tasks/utils/task-schedule-view";
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
  TaskSchedule,
  WorkspaceCalendarSource,
} from "@/lib/clients/generated/core";
import { SourceMarker } from "./source-marker";
import type { CalendarCoworker } from "./workspace-calendar";

interface CalendarScheduleListProps {
  /** The workspace roster the assignee and owner are looked up in. */
  coworkers: CalendarCoworker[];
  hasMore: boolean;
  isLoading: boolean;
  loadMoreError: boolean;
  onLoadMore: () => void;
  schedules: TaskSchedule[];
  sources: WorkspaceCalendarSource[];
  timeZone: string;
}

function findSource(
  schedule: TaskSchedule,
  sources: WorkspaceCalendarSource[],
): WorkspaceCalendarSource | undefined {
  const sourceId = schedule.projectId
    ? `project:${schedule.projectId}`
    : `workspace:${schedule.workspaceId}`;

  return sources.find((source) => source.sourceId === sourceId);
}

function findAssignee(
  schedule: TaskSchedule,
  coworkers: CalendarCoworker[],
): TaskAssigneeView | null {
  const assigneeId = taskScheduleAssigneeId(schedule);
  const assignee = coworkers.find(({ id }) => id === assigneeId);
  return assignee ? { ...assignee, kind: assignee.kind ?? "coworker" } : null;
}

/** The Calendar's Schedules view: every Task Schedule, with its next Run. */
export function CalendarScheduleList({
  coworkers,
  hasMore,
  isLoading,
  loadMoreError,
  onLoadMore,
  schedules,
  sources,
  timeZone,
}: CalendarScheduleListProps) {
  const t = useTranslations("App.Calendar");
  const tSchedule = useTranslations("App.Tasks.Schedule");
  const tSchedules = useTranslations("App.Tasks.Schedules");
  const formatter = useFormatter();

  return (
    <div className="flex flex-col gap-4">
      {schedules.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {schedules.map((schedule) => {
            const nextRunLabel = schedule.nextRunAt
              ? formatter.dateTime(schedule.nextRunAt, "dateTime", {
                  timeZone,
                })
              : null;
            const source = findSource(schedule, sources);
            const sourceName = source?.displayName ?? t("source.WORKSPACE");
            const assignee = findAssignee(schedule, coworkers);
            const owner = coworkers.find(
              ({ id, kind }) => kind === "user" && id === schedule.ownerId,
            );
            const peopleNames = [assignee?.name, owner?.name]
              .filter((name): name is string => Boolean(name?.trim()))
              .join(", ");

            return (
              <Card
                className="bg-background gap-3 py-4"
                data-testid="calendar-schedule-row"
                key={schedule.id}
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
                          {owner ? (
                            <UserProfileAvatar
                              className="z-10"
                              image={owner.image}
                              name={owner.name}
                              size="lg"
                            />
                          ) : null}
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
                        <Link
                          className="text-foreground line-clamp-2 text-sm font-medium hover:underline"
                          href={taskSchedulePath(schedule.id)}
                        >
                          {schedule.name}
                        </Link>
                      </CardTitle>
                      <CardDescription className="line-clamp-1 text-xs">
                        {formatTaskScheduleRule(
                          schedule.rule,
                          formatter,
                          tSchedule,
                        )}
                      </CardDescription>
                    </div>
                  </div>
                  <TaskScheduleStateBadge
                    schedule={schedule}
                    label={tSchedules(`state.${schedule.state}`)}
                  />
                </CardHeader>
                <CardFooter className="mt-auto px-4 text-xs">
                  <span className="text-muted-foreground tabular-nums">
                    {nextRunLabel
                      ? `${t("schedules.nextRun")}: ${nextRunLabel}`
                      : t("schedules.noNextRun")}
                  </span>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="text-muted-foreground border-border flex items-center justify-center rounded-xl border py-16 text-sm">
          {tSchedules("empty")}
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
