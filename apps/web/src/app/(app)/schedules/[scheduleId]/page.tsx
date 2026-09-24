import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import TaskDetailLoading from "@/app/tasks/[taskId]/loading";
import { TaskDescription } from "@/app/tasks/components/task-description";
import { TaskScheduleActions } from "@/app/tasks/components/task-schedule-actions";
import { TaskScheduleStateBadge } from "@/app/tasks/components/task-schedule-state-badge";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import {
  TASK_DETAIL_GRID_CLASS,
  TASK_DETAIL_MAIN_CLASS,
  TASK_DETAIL_SHELL_CLASS,
  TASK_DETAIL_SIDEBAR_CLASS,
} from "@/app/tasks/constants";
import { listTaskScheduleAssigneeDisplayOptions } from "@/app/tasks/utils/task-schedule-assignee-options";
import {
  formatTaskScheduleRule,
  TASK_SCHEDULES_PATH,
  taskScheduleAssigneeLabel,
} from "@/app/tasks/utils/task-schedule-view";
import { buildTaskStatusLabels } from "@/app/tasks/utils/task-status-labels";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/auth/auth.server";
import {
  type TaskSchedule,
  TaskScheduleEndsMode,
  TaskScheduleState,
} from "@/lib/clients/generated/core";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { taskService } from "@/lib/services/task.service";
import { taskScheduleService } from "@/lib/services/task-schedule.service";

const UPCOMING_RUNS_LIMIT = 10;
// ponytail: one max page, then drop CANCELED. Page further if a schedule can cancel more than 100 future runs.
const UPCOMING_RUNS_FETCH_LIMIT = 100;
const CREATED_TASKS_LIMIT = 20;

interface TaskScheduleDetailPageProps {
  params: Promise<{ scheduleId: string }>;
}

export default function TaskScheduleDetailPage({
  params,
}: TaskScheduleDetailPageProps) {
  return (
    <Suspense fallback={<TaskDetailLoading />}>
      <TaskScheduleDetailContent params={params} />
    </Suspense>
  );
}

async function TaskScheduleDetailContent({
  params,
}: TaskScheduleDetailPageProps) {
  const { scheduleId } = await params;
  await connection();
  const [schedule, session] = await Promise.all([
    taskScheduleService.getSchedule(scheduleId),
    getSession(),
  ]);
  if (!schedule || !session) {
    notFound();
  }

  const activeOrganizationId = session.session.activeOrganizationId ?? null;
  const [
    coworkerOptions,
    projectOptions,
    runs,
    createdTasks,
    t,
    tSchedule,
    tStatus,
    tTaskDetail,
    formatter,
  ] = await Promise.all([
    listTaskScheduleAssigneeDisplayOptions(activeOrganizationId),
    getProjectFilterOptions(schedule.projectId),
    taskScheduleService.listUpcomingRuns(schedule.id, {
      from: new Date(),
      limit: UPCOMING_RUNS_FETCH_LIMIT,
    }),
    taskService.listTasks({
      scheduleId: schedule.id,
      scope: "workspace",
      sort: "createdAt",
      limit: CREATED_TASKS_LIMIT,
    }),
    getTranslations("App.Tasks.Schedules"),
    getTranslations("App.Tasks.Schedule"),
    getTranslations("App.Tasks.Filters.statusOptions"),
    getTranslations("App.Tasks.Detail"),
    getFormatter(),
  ]);
  const statusLabels = buildTaskStatusLabels((key) => tStatus(key));
  const project = projectOptions.find(
    (option) => option.id === schedule.projectId,
  );
  const upcomingRuns = runs
    .filter((run) => run.state !== "CANCELED")
    .slice(0, UPCOMING_RUNS_LIMIT);

  return (
    <div className="min-h-full w-full">
      <div className={TASK_DETAIL_SHELL_CLASS}>
        <div className={TASK_DETAIL_GRID_CLASS}>
          <div className={TASK_DETAIL_MAIN_CLASS}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Link
                  href={TASK_SCHEDULES_PATH}
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
                >
                  <ArrowLeft className="size-4" aria-hidden />
                  {t("Detail.back")}
                </Link>
                {session.user.id === schedule.ownerId ? (
                  <TaskScheduleActions
                    schedule={schedule}
                    coworkerOptions={coworkerOptions}
                    projectOptions={projectOptions}
                    canCreatePrivate={activeOrganizationId !== null}
                  />
                ) : null}
              </div>
              <h1 className="text-xl leading-tight font-semibold tracking-tight">
                {schedule.name}
              </h1>
            </div>

            {schedule.description ? (
              <TaskDescription
                title={tTaskDetail("description")}
                description={schedule.description}
                expandLabel={tTaskDetail("expand")}
                collapseLabel={tTaskDetail("collapse")}
              />
            ) : null}

            <section className="space-y-3">
              <h2 className="text-muted-foreground text-xs font-medium">
                {t("Detail.upcomingRuns")}
              </h2>
              {upcomingRuns.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {schedule.state === TaskScheduleState.ACTIVE
                    ? t("Detail.noUpcomingRuns")
                    : t("Detail.noUpcomingRunsInactive")}
                </p>
              ) : (
                <ul className="divide-border divide-y rounded-lg border">
                  {upcomingRuns.map((run) => {
                    const isMoved =
                      run.originalScheduledAt !== null &&
                      run.originalScheduledAt.getTime() !==
                        run.effectiveScheduledAt.getTime();
                    return (
                      <li
                        key={run.id}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                      >
                        <span
                          className={
                            run.state === "SKIPPED"
                              ? "text-muted-foreground tabular-nums line-through"
                              : "tabular-nums"
                          }
                        >
                          {formatter.dateTime(
                            run.effectiveScheduledAt,
                            "dateTimeMedium",
                          )}
                        </span>
                        {run.state === "SKIPPED" ? (
                          <Badge variant="outline" className="rounded-sm">
                            {t("Detail.runSkipped")}
                          </Badge>
                        ) : isMoved ? (
                          <Badge variant="outline" className="rounded-sm">
                            {t("Detail.runMoved")}
                          </Badge>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-muted-foreground text-xs font-medium">
                {t("Detail.createdTasks")}
              </h2>
              {createdTasks.tasks.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t("Detail.noCreatedTasks")}
                </p>
              ) : (
                <ul className="divide-border divide-y rounded-lg border">
                  {createdTasks.tasks.map((task) => (
                    <li key={task.id}>
                      <Link
                        href={`/tasks/${task.id}`}
                        className="hover:bg-card-background-hover flex items-center justify-between gap-3 px-4 py-2.5 transition-colors"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {task.name}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                          {formatter.dateTime(task.createdAt, "dateTime")}
                        </span>
                        <TaskStatusBadge
                          status={task.status}
                          label={statusLabels[task.status]}
                          className="rounded-sm"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className={TASK_DETAIL_SIDEBAR_CLASS}>
            <section className="space-y-4">
              <h2 className="text-muted-foreground text-xs font-medium">
                {t("Detail.properties")}
              </h2>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
                <Property label={t("Detail.state")}>
                  <TaskScheduleStateBadge
                    schedule={schedule}
                    label={t(`state.${schedule.state}`)}
                  />
                </Property>
                <Property label={t("Detail.rule")}>
                  {formatTaskScheduleRule(schedule.rule, formatter, tSchedule)}
                </Property>
                <Property label={t("Detail.timezone")}>
                  {schedule.rule.timezone}
                </Property>
                <Property label={t("Detail.nextRun")}>
                  {schedule.nextRunAt
                    ? formatter.dateTime(schedule.nextRunAt, "dateTimeMedium")
                    : t("noNextRun")}
                </Property>
                <Property label={t("Detail.ends")}>
                  {formatEnds(schedule, t, (date) =>
                    formatter.dateTime(date, { dateStyle: "medium" }),
                  )}
                </Property>
                <Property label={t("Detail.assignee")}>
                  {taskScheduleAssigneeLabel(schedule, coworkerOptions, {
                    unassigned: t("unassigned"),
                    unavailable: t("unavailableAssignee"),
                  })}
                </Property>
                <Property label={t("Detail.project")}>
                  {project ? (
                    <Link
                      href={`/projects/${project.id}`}
                      className="hover:underline"
                    >
                      {project.name}
                    </Link>
                  ) : (
                    t("Detail.noProject")
                  )}
                </Property>
                <Property label={t("Detail.released")}>
                  <span className="tabular-nums">
                    {formatter.number(schedule.releasedCount)}
                  </span>
                </Property>
              </dl>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Property({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function formatEnds(
  schedule: TaskSchedule,
  t: Awaited<ReturnType<typeof getTranslations<"App.Tasks.Schedules">>>,
  formatDate: (date: Date) => string,
): string {
  const { endsMode, endsOn, targetRunCount } = schedule.rule;
  if (endsMode === TaskScheduleEndsMode.ON && endsOn) {
    return t("Detail.endsOn", { date: formatDate(endsOn) });
  }
  if (endsMode === TaskScheduleEndsMode.AFTER && targetRunCount != null) {
    return t("Detail.endsAfter", { count: targetRunCount });
  }
  return t("Detail.endsNever");
}
