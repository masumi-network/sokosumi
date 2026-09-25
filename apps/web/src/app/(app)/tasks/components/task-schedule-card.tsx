"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TaskSchedule } from "@/lib/clients/generated/core";
import type { CoworkerOption } from "@/lib/types/coworker";

import { TaskScheduleDialog } from "./task-schedule-dialog";
import { TaskScheduleStateBadge } from "./task-schedule-state-badge";

interface TaskScheduleCardProps {
  schedule: TaskSchedule;
  /** Names and avatars of stored assignees, wider than the create picker. */
  assigneeDisplayOptions: CoworkerOption[];
  /** The create picker's choices, for the edit dialog. */
  coworkerOptions: CoworkerOption[];
  projectOptions: ProjectFilterOption[];
  currentUserId: string | null;
  canCreatePrivate: boolean;
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
 * its next run. Its owner edits it in place; everyone opens its detail page.
 */
export function TaskScheduleCard({
  schedule,
  assigneeDisplayOptions,
  coworkerOptions,
  projectOptions,
  currentUserId,
  canCreatePrivate,
}: TaskScheduleCardProps) {
  const t = useTranslations("App.Tasks.Schedules");
  const tSchedule = useTranslations("App.Tasks.Schedule");
  const tActions = useTranslations("App.Tasks.Schedules.Actions");
  const formatter = useFormatter();
  const [isEditOpen, setIsEditOpen] = useState(false);

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
    <li>
      <Card
        className="bg-background h-full gap-0 py-0"
        data-testid="schedule-card"
      >
        <CardHeader className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            {project ? (
              <ProjectAvatar
                className="size-4 rounded-sm"
                logo={project.logo}
                name={project.name}
              />
            ) : (
              <span aria-hidden className="bg-primary size-4 rounded-full" />
            )}
            <span className="line-clamp-1">{sourceName}</span>
          </span>
          <TaskScheduleStateBadge
            label={t(`state.${schedule.state}`)}
            schedule={schedule}
          />
        </CardHeader>
        <CardContent className="border-border flex flex-1 flex-col items-start gap-2 border-t px-4 py-4">
          {/* A stored assignee the workspace no longer lists keeps a face. */}
          {assigneeId ? (
            <span
              aria-hidden
              className="flex shrink-0 items-center"
              data-testid="schedule-card-assignee"
              title={assigneeLabel}
            >
              <AssigneeAvatar
                assignee={assignee ? toAssigneeView(assignee) : null}
                size="lg"
              />
            </span>
          ) : null}
          <span className="sr-only">{assigneeLabel}</span>
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle>
              <Link
                className="text-foreground line-clamp-2 text-sm font-medium hover:underline"
                href={taskSchedulePath(schedule.id)}
                title={t("openSchedule")}
              >
                {schedule.name}
              </Link>
            </CardTitle>
            <CardDescription className="line-clamp-1 text-xs">
              {formatTaskScheduleRule(schedule.rule, formatter, tSchedule)}
            </CardDescription>
          </div>
        </CardContent>
        <CardFooter className="items-end justify-between gap-3 px-4 pb-4 text-xs">
          <span className="text-muted-foreground tabular-nums">
            {nextRunLabel}
          </span>
          {schedule.ownerId === currentUserId ? (
            <Button
              aria-label={tActions("edit")}
              className="-my-2 -mr-2 shrink-0"
              onClick={() => setIsEditOpen(true)}
              size="icon"
              variant="ghost"
            >
              <Pencil aria-hidden />
            </Button>
          ) : null}
        </CardFooter>
      </Card>
      {isEditOpen ? (
        <TaskScheduleDialog
          canCreatePrivate={canCreatePrivate}
          coworkerOptions={coworkerOptions}
          onClose={() => setIsEditOpen(false)}
          projectOptions={projectOptions}
          schedule={schedule}
        />
      ) : null}
    </li>
  );
}
