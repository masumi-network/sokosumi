"use client";

import { TaskStatus } from "@sokosumi/utils";
import { useTranslations } from "next-intl";

import { TaskScheduleDisplay } from "@/components/task-schedule-display";
import type { TaskStatus as TaskStatusType } from "@/lib/types/core-dto";
import type { TaskWithCoworker } from "@/lib/types/task";
import { cn } from "@/lib/utils";
import { hasActiveSchedule } from "@/lib/utils/task-schedule";
import { TaskDetailLink } from "./task-detail-link";
import type { DragHandleProps } from "./task-dnd";
import { TaskMetaDetails } from "./task-meta";
import { TaskStatusBadge } from "./task-status-badge";

interface TaskCardProps {
  task: TaskWithCoworker;
  dragHandleProps?: DragHandleProps;
  compact?: boolean;
  statusLabels?: Record<TaskStatusType, string>;
}

export function TaskCard({
  task,
  dragHandleProps,
  compact = false,
  statusLabels,
}: TaskCardProps) {
  const t = useTranslations("App.Tasks.AwaitingVendorApprovalBadge");
  const handleProps = dragHandleProps
    ? {
        ...dragHandleProps.attributes,
        ...dragHandleProps.listeners,
      }
    : null;

  return (
    <div
      className={cn(
        "group",
        dragHandleProps && "cursor-grab",
        dragHandleProps?.isDragging && "scale-[1.02] opacity-60",
      )}
      {...handleProps}
    >
      <TaskDetailLink href={`/tasks/${task.id}`} className="block">
        <article
          className={cn(
            "bg-background rounded-lg p-3 transition-all duration-200",
            "border-border border",
            "hover:border-primary hover:shadow-sm",
            "active:scale-[0.99]",
            dragHandleProps?.isDragging &&
              "border-primary/30 ring-primary/10 shadow-lg ring-2",
          )}
        >
          <div className="space-y-2.5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {task.awaitingVendorApproval ? (
                  <span className="bg-amber-500/10 text-amber-700 dark:text-amber-300 shrink-0 rounded-sm px-2 py-0.5 text-xs font-medium">
                    {t("label")}
                  </span>
                ) : null}
                <TaskStatusBadge
                  status={task.status}
                  label={statusLabels?.[task.status]}
                  showDot={task.columnId === "in-progress"}
                  className="w-fit rounded-sm"
                />
              </div>
              <h3 className="text-foreground line-clamp-2 text-sm leading-snug font-medium">
                {task.name}
              </h3>
            </div>

            {!compact && (task.descriptionPlain || task.description) ? (
              <div className="space-y-1.5">
                <p className="text-muted-foreground/80 line-clamp-2 text-xs leading-relaxed break-all">
                  {task.descriptionPlain ?? task.description}
                </p>
              </div>
            ) : null}

            {task.status === TaskStatus.QUEUED &&
            hasActiveSchedule(
              task.metadata,
              task.nextRunAt ? new Date(task.nextRunAt) : null,
            ) ? (
              <TaskScheduleDisplay
                variant="card"
                metadata={task.metadata}
                nextRunAt={task.nextRunAt ? new Date(task.nextRunAt) : null}
              />
            ) : null}

            <TaskMetaDetails
              owner={task.user}
              coworker={task.coworker}
              commentsCount={task.commentsCount}
              createdAt={task.createdAt}
              variant="card"
            />
          </div>
        </article>
      </TaskDetailLink>
    </div>
  );
}
