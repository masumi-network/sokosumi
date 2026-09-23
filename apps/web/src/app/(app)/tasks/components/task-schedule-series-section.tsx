import { getFormatter, getTimeZone, getTranslations } from "next-intl/server";

import { TaskScheduleOccurrences } from "@/app/tasks/components/task-schedule-occurrences";
import { TaskScheduleSeries } from "@/app/tasks/components/task-schedule-series";
import { TaskScheduleSourceMove } from "@/app/tasks/components/task-schedule-source-move";
import { buildTaskScheduleSeriesView } from "@/app/tasks/utils/task-schedule-series-view";
import { TASK_SCHEDULE_OCCURRENCE_PAGE_LIMIT } from "@/app/tasks/utils/tasks-pagination";
import {
  computeScheduleTitleInfo,
  formatScheduleTitle,
} from "@/components/schedules/format";
import { hasCurrentUserCalendarBetaAccess } from "@/lib/calendar-beta-access.server";
import type { Task } from "@/lib/clients/generated/core/types.gen";
import { taskService } from "@/lib/services/task.service";
import { taskScheduleService } from "@/lib/services/task-schedule.service";

interface TaskScheduleSeriesSectionProps {
  task: Pick<Task, "id" | "metadata" | "nextRunAt" | "scheduleRevision">;
  /** Already-translated name of the workspace Calendar the series releases into. */
  workspaceName: string;
  forceReadOnly: boolean;
  projectPromise: Promise<{ id: string; name: string } | null>;
}

/**
 * The Calendar schedule series lives here: Task detail is its canonical home.
 * The section is server-rendered down to the first page of each occurrence
 * view; only the tabs and "load more" below need the client.
 *
 * Skipped for the admin read-only route — the occurrence ledger is scoped to
 * the Task's owner, so an admin read would only produce a 403.
 */
export async function TaskScheduleSeriesSection({
  task,
  workspaceName,
  forceReadOnly,
  projectPromise,
}: TaskScheduleSeriesSectionProps) {
  if (forceReadOnly || !(await hasCurrentUserCalendarBetaAccess())) {
    return null;
  }

  const viewerTimeZone = await getTimeZone();
  const project = await projectPromise;
  const view = buildTaskScheduleSeriesView({
    metadata: task.metadata,
    nextRunAt: task.nextRunAt,
    scheduleRevision: task.scheduleRevision,
    project,
    workspaceName,
    viewerTimeZone,
  });

  if (!view) {
    return null;
  }

  // The summary is derived from the Task alone, so it renders whether or not
  // the ledger answers. Only the occurrence region degrades.
  const [pages, sources] = await Promise.all([
    Promise.all([
      taskScheduleService.listOccurrences(task.id, {
        view: "upcoming",
        limit: TASK_SCHEDULE_OCCURRENCE_PAGE_LIMIT,
      }),
      taskScheduleService.listOccurrences(task.id, {
        view: "history",
        limit: TASK_SCHEDULE_OCCURRENCE_PAGE_LIMIT,
      }),
    ]).catch((error: unknown) => {
      console.error("Failed to read task schedule occurrences", {
        taskId: task.id,
        error,
      });
      return null;
    }),
    view.isActive
      ? taskService.getWorkspaceCalendarSources().catch((error: unknown) => {
          console.error("Failed to read Calendar sources", {
            taskId: task.id,
            error,
          });
          return [];
        })
      : Promise.resolve([]),
  ]);
  const currentSourceId = project
    ? `project:${project.id}`
    : (sources.find((source) => source.sourceType === "WORKSPACE")?.sourceId ??
      null);

  const [t, tSchedule, tSource, formatter] = await Promise.all([
    getTranslations("App.Tasks.Detail.ScheduleSeries"),
    getTranslations("App.Tasks.Schedule"),
    getTranslations("App.Calendar.source"),
    getFormatter(),
  ]);

  return (
    <TaskScheduleSeries
      labels={{
        title: t("title"),
        calendar: t("calendar"),
        repeats: t("repeats"),
        timezone: t("timezone"),
        nextRun: t("nextRun"),
        removed: t("removed"),
      }}
      calendar={{
        name: view.calendar.name,
        href: view.calendar.href,
        sourceLabel: tSource(view.calendar.source),
        action:
          pages && currentSourceId ? (
            <TaskScheduleSourceMove
              taskId={task.id}
              currentSourceId={currentSourceId}
              scheduleRevision={pages[0].scheduleRevision}
              futureExceptionCount={pages[0].futureExceptionCount}
              sources={sources}
            />
          ) : undefined,
      }}
      recurrenceLabel={
        view.rule
          ? formatScheduleTitle(
              computeScheduleTitleInfo(view.rule, formatter),
              tSchedule,
            )
          : null
      }
      timezone={view.timezone}
      nextRunLabel={
        task.nextRunAt
          ? formatter.dateTime(task.nextRunAt, "dateTime", {
              timeZone: view.timezone ?? viewerTimeZone,
            })
          : null
      }
      isActive={view.isActive}
    >
      {pages ? (
        <TaskScheduleOccurrences
          // Each view is read independently. Keying both revisions remounts
          // the island when either page changes instead of retaining stale
          // useState from the other view.
          key={`${pages[0].scheduleRevision}:${pages[1].scheduleRevision}`}
          taskId={task.id}
          scheduleRevision={pages[0].scheduleRevision}
          upcoming={{
            occurrences: pages[0].occurrences,
            nextCursor: pages[0].nextCursor,
          }}
          history={{
            occurrences: pages[1].occurrences,
            nextCursor: pages[1].nextCursor,
          }}
          hasActiveSchedule={view.isActive}
        />
      ) : (
        <p className="text-muted-foreground text-sm">{t("occurrencesError")}</p>
      )}
    </TaskScheduleSeries>
  );
}
