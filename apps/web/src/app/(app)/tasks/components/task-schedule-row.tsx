"use client";

import type { TaskSchedule } from "@sokosumi/core-client";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import { AssigneeAvatar } from "@/app/tasks/components/assignee-avatar";
import type { TaskAssigneeView } from "@/app/tasks/types/task-board";
import {
  formatTaskScheduleRule,
  taskScheduleAssigneeId,
  taskScheduleAssigneeLabel,
  taskSchedulePath,
} from "@/app/tasks/utils/task-schedule-view";
import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import {
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import type { CoworkerOption } from "@/lib/types/coworker";
import type { SchedulesViewMode } from "@/lib/ui-preferences/schedules-view-mode";
import { cn } from "@/lib/utils";

import { TaskScheduleActions } from "./task-schedule-actions";
import { TaskScheduleStateBadge } from "./task-schedule-state-badge";

interface TaskScheduleRowProps {
  schedule: TaskSchedule;
  viewMode?: SchedulesViewMode;
  /** Names and avatars of stored assignees, wider than the create picker. */
  assigneeDisplayOptions: CoworkerOption[];
  /** The create picker's choices, for the edit dialog. */
  coworkerOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
  canCreatePrivate: boolean;
  onChanged: () => void;
}

function toAssigneeView(option: CoworkerOption): TaskAssigneeView {
  return {
    id: option.id,
    name: option.name,
    image: option.image,
    slug: option.slug,
    kind: option.kind ?? "coworker",
    avatarSeed: option.avatarSeed,
  };
}

/**
 * One Task Schedule: who runs it and where it lives, its rule, its state, and
 * its next run. Members who may change it do so in place; everyone opens its
 * detail page.
 */
export function TaskScheduleRow({
  schedule,
  viewMode = "list",
  assigneeDisplayOptions,
  coworkerOptions,
  projectOptions,
  canCreatePrivate,
  onChanged,
}: TaskScheduleRowProps) {
  const t = useTranslations("App.Tasks.Schedules");
  const tSchedule = useTranslations("App.Tasks.Schedule");
  const formatter = useFormatter();

  const assigneeId = taskScheduleAssigneeId(schedule);
  const assignee = assigneeId
    ? (assigneeDisplayOptions.find((option) => option.id === assigneeId) ??
      null)
    : null;
  const project = schedule.projectId
    ? (projectOptions.find((option) => option.id === schedule.projectId) ??
      null)
    : null;
  const sourceName = project?.name ?? t("workspace");
  const assigneeLabel = taskScheduleAssigneeLabel(
    schedule,
    assigneeDisplayOptions,
    { unassigned: t("unassigned"), unavailable: t("unavailableAssignee") },
  );
  const nextRunLabel = schedule.nextRunAt
    ? t("nextRun", {
        datetime: formatter.dateTime(schedule.nextRunAt, "dateTimeMedium"),
      })
    : t("noNextRun");

  return (
    <li
      className={cn(
        HOLDER_ITEM_CLASS,
        HOLDER_ITEM_HOVER_CLASS,
        "press relative flex min-w-0 flex-col gap-3 p-3 transition-colors",
        viewMode === "list" && "lg:flex-row lg:items-center",
      )}
      data-testid="schedule-row"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          aria-hidden
          className="shrink-0"
          data-testid="schedule-row-assignee"
          title={assigneeLabel}
        >
          <AssigneeAvatar
            assignee={assignee ? toAssigneeView(assignee) : null}
            size="sm"
          />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link
              className="text-foreground text-sm font-medium break-words after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
              href={taskSchedulePath(schedule.id)}
            >
              {schedule.name}
            </Link>
            <TaskScheduleStateBadge
              label={t(`state.${schedule.state}`)}
              schedule={schedule}
            />
          </div>
          <div
            className={cn(
              "text-muted-foreground flex gap-x-3 gap-y-1 text-xs",
              viewMode === "grid"
                ? "flex-col items-start"
                : "flex-wrap items-center",
            )}
          >
            <span>{assigneeLabel}</span>
            <span className="flex min-w-0 items-center gap-1.5">
              {project ? (
                <ProjectAvatar
                  className="size-4 rounded-sm"
                  logo={project.logo}
                  name={project.name}
                />
              ) : null}
              <span className="break-words">{sourceName}</span>
            </span>
            <span>
              {formatTaskScheduleRule(schedule.rule, formatter, tSchedule)}
            </span>
            <span className="tabular-nums">{nextRunLabel}</span>
          </div>
        </div>
      </div>
      {schedule.canWrite ? (
        <div className="relative z-10 shrink-0">
          <TaskScheduleActions
            onChanged={onChanged}
            schedule={schedule}
            coworkerOptions={coworkerOptions}
            projectOptions={projectOptions}
            canCreatePrivate={canCreatePrivate}
          />
        </div>
      ) : null}
    </li>
  );
}
