"use client";

import { CalendarSync, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { loadMoreTaskSchedules } from "@/app/tasks/actions";
import {
  parseTaskScheduleStateFilter,
  TASK_SCHEDULE_STATE_PARAM,
  taskScheduleAssigneeId,
} from "@/app/tasks/utils/task-schedules-filters";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import {
  computeScheduleTitleInfo,
  formatScheduleTitle,
} from "@/components/schedules/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type TaskSchedule,
  TaskScheduleState,
} from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";
import { TaskPrivateIndicator } from "./task-private-indicator";
import { TaskScheduleDialog } from "./task-schedule-dialog";

const ALL_STATES = "all";

interface TaskSchedulesViewProps {
  /** Null while the page has not loaded them yet. */
  schedules: TaskSchedule[] | null;
  nextCursor: string | null;
  coworkerOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
  canCreate: boolean;
  canCreatePrivate: boolean;
}

/**
 * The Task Manager's Schedules view: every Task Schedule of the workspace,
 * filtered by the project switcher and by state.
 */
export function TaskSchedulesView({
  schedules,
  nextCursor,
  coworkerOptions,
  projectOptions,
  canCreate,
  canCreatePrivate,
}: TaskSchedulesViewProps) {
  const t = useTranslations("App.Tasks.Schedules");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = parseTaskScheduleStateFilter(
    searchParams.get(TASK_SCHEDULE_STATE_PARAM),
  );
  const projectId = searchParams.get("projectId");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [more, setMore] = useState<{
    schedules: TaskSchedule[];
    nextCursor: string | null;
  }>({ schedules: [], nextCursor });
  const [isLoadingMore, startLoadingMore] = useTransition();

  function handleStateChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    const nextState = parseTaskScheduleStateFilter(next);
    if (nextState) {
      params.set(TASK_SCHEDULE_STATE_PARAM, nextState);
    } else {
      params.delete(TASK_SCHEDULE_STATE_PARAM);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  function handleLoadMore() {
    const cursor = more.nextCursor;
    if (!cursor) return;
    startLoadingMore(async () => {
      try {
        const page = await loadMoreTaskSchedules({ cursor, projectId, state });
        setMore((current) => ({
          schedules: [...current.schedules, ...page.schedules],
          nextCursor: page.nextCursor,
        }));
      } catch {
        toast.error(t("loadMoreError"));
      }
    });
  }

  // A refresh can bring back rows a "Load more" already appended.
  const rows = schedules
    ? [
        ...schedules,
        ...more.schedules.filter(
          (extra) => !schedules.some((row) => row.id === extra.id),
        ),
      ]
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="single"
          value={state ?? ALL_STATES}
          onValueChange={(next) => {
            if (next) handleStateChange(next);
          }}
          aria-label={t("stateFilter")}
          className="bg-card-background gap-1 rounded-lg p-1"
        >
          <ToggleGroupItem value={ALL_STATES} className="px-3 text-sm">
            {t("filterAll")}
          </ToggleGroupItem>
          {Object.values(TaskScheduleState).map((value) => (
            <ToggleGroupItem key={value} value={value} className="px-3 text-sm">
              {t(`state.${value}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {canCreate ? (
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t("newSchedule")}
          </Button>
        ) : null}
      </div>

      <div className="bg-card-background border-border -mx-4 overflow-hidden rounded-none border-0 md:mx-0 md:rounded-xl md:border">
        {rows === null ? (
          <p className="text-muted-foreground py-16 text-center text-sm">
            {t("loading")}
          </p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <CalendarSync
              className="text-muted-foreground size-6"
              aria-hidden
            />
            <p className="text-muted-foreground max-w-sm text-sm text-pretty">
              {t("empty")}
            </p>
          </div>
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((schedule) => (
              <TaskScheduleRow
                key={schedule.id}
                schedule={schedule}
                coworkerOptions={coworkerOptions}
              />
            ))}
          </ul>
        )}
        {rows && more.nextCursor ? (
          <div className="border-border border-t px-4 py-3">
            <Button
              variant="outline"
              className="text-muted-foreground hover:text-foreground w-full text-xs"
              onClick={handleLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? t("loadingMore") : t("loadMore")}
            </Button>
          </div>
        ) : null}
      </div>

      {isCreateOpen ? (
        <TaskScheduleDialog
          initialBlueprint={{ projectId }}
          coworkerOptions={coworkerOptions}
          projectOptions={projectOptions}
          canCreatePrivate={canCreatePrivate}
          onClose={() => setIsCreateOpen(false)}
          onSaved={(scheduleId) =>
            router.push(`/tasks/schedules/${scheduleId}`)
          }
        />
      ) : null}
    </div>
  );
}

function TaskScheduleRow({
  schedule,
  coworkerOptions,
}: {
  schedule: TaskSchedule;
  coworkerOptions: CoworkerOption[];
}) {
  const t = useTranslations("App.Tasks.Schedules");
  const tSchedule = useTranslations("App.Tasks.Schedule");
  const formatter = useFormatter();
  const assigneeId = taskScheduleAssigneeId(schedule);
  const assignee = assigneeId
    ? coworkerOptions.find((option) => option.id === assigneeId)
    : null;
  const ruleLabel = formatScheduleTitle(
    computeScheduleTitleInfo(
      {
        scheduleType: "CRON",
        cron: schedule.rule.expr,
        timezone: schedule.rule.timezone,
        intervalDays: schedule.rule.intervalDays,
      },
      formatter,
    ),
    tSchedule,
  );

  return (
    <li>
      <Link
        href={`/tasks/schedules/${schedule.id}`}
        className="hover:bg-card-background-hover flex flex-col gap-2 px-4 py-3 transition-colors sm:flex-row sm:items-center sm:gap-4"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-foreground line-clamp-1 text-sm font-medium">
            {schedule.name}
          </span>
          <span className="text-muted-foreground line-clamp-1 text-xs">
            {ruleLabel}
          </span>
        </div>
        <div className="text-muted-foreground flex shrink-0 items-center gap-3 text-xs sm:gap-4">
          <span className="tabular-nums">
            {schedule.nextRunAt
              ? t("nextRun", {
                  datetime: formatter.dateTime(
                    schedule.nextRunAt,
                    "dateTimeMedium",
                  ),
                })
              : t("noNextRun")}
          </span>
          <span className="max-w-40 truncate">
            {assignee
              ? assignee.name
              : assigneeId
                ? t("unavailableAssignee")
                : t("unassigned")}
          </span>
          <span className="flex items-center gap-1.5">
            <Badge
              variant={
                schedule.state === TaskScheduleState.ACTIVE
                  ? "secondary"
                  : "outline"
              }
              className="rounded-sm"
            >
              {t(`state.${schedule.state}`)}
            </Badge>
            <TaskPrivateIndicator visibility={schedule.visibility} />
          </span>
        </div>
      </Link>
    </li>
  );
}
