"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ProjectAvatar } from "@/app/projects/components/project-avatar";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import type { TaskStatus as TaskStatusType } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";
import { TaskDetailLink } from "./task-detail-link";
import type { DragHandleProps } from "./task-dnd";
import { TaskMetaDetails } from "./task-meta";
import { TaskPrivateIndicator } from "./task-private-indicator";
import { TaskRunAtBadge } from "./task-run-at-badge";
import { TaskStatusBadge } from "./task-status-badge";
import { TaskTags } from "./task-tags";

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
  const t = useTranslations("App.Tasks.Tags");
  const handleProps = dragHandleProps
    ? { ...dragHandleProps.attributes, ...dragHandleProps.listeners }
    : null;
  return (
    <div
      className={cn(
        "group",
        dragHandleProps && "cursor-grab",
        dragHandleProps?.isDragging && "opacity-60",
      )}
      {...handleProps}
    >
      <article
        className={cn(
          "bg-background border-border relative isolate rounded-lg border transition-[border-color,box-shadow,transform] hover:border-primary hover:shadow-sm motion-safe:active:scale-[0.995]",
          compact ? "space-y-1 p-2" : "space-y-2.5 p-3",
          dragHandleProps?.isDragging &&
            "border-primary-tertiary ring-ring-halo shadow-lg ring-2",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TaskStatusBadge
            status={task.status}
            label={statusLabels?.[task.status]}
            className="w-fit rounded-sm"
          />
          <TaskPrivateIndicator visibility={task.visibility} />
        </div>
        <h3
          className={cn(
            "text-foreground text-sm leading-snug font-medium",
            compact ? "line-clamp-1" : "line-clamp-2",
          )}
        >
          <TaskDetailLink
            href={`/tasks/${task.id}`}
            title={task.name}
            className="after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-ring"
          >
            {task.name}
          </TaskDetailLink>
        </h3>
        {!compact && (
          <>
            <TaskTags tags={task.tags} />
            {task.project ? (
              <Link
                href={`/projects/${task.project.id}`}
                title={task.project.name}
                aria-label={t("openProject", { name: task.project.name })}
                className="text-muted-foreground hover:text-foreground focus-visible:outline-ring relative z-10 flex min-h-8 min-w-0 items-center gap-2 rounded-sm text-xs hover:underline focus-visible:outline-2"
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <ProjectAvatar
                  name={task.project.name}
                  logo={task.project.logo}
                  className="size-5 shrink-0 rounded-sm"
                />
                <span className="min-w-0 line-clamp-2 break-words">
                  {task.project.name}
                </span>
              </Link>
            ) : (
              <p className="text-muted-foreground text-xs">{t("noProject")}</p>
            )}
          </>
        )}
        {task.runAt ? (
          <TaskRunAtBadge runAt={task.runAt} className="flex" />
        ) : null}
        <TaskMetaDetails
          project={null}
          assignee={task.assignee}
          participants={task.participants}
          commentsCount={task.commentsCount}
          createdAt={task.createdAt}
          variant="card"
        />
      </article>
    </div>
  );
}
