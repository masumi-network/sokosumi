"use client";

import { TaskStatus } from "@sokosumi/core-client";
import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { taskHref } from "@/app/tasks/utils/task-href";
import { cn } from "@/lib/utils";
import { TaskDetailLink } from "./task-detail-link";
import type { DragHandleProps } from "./task-dnd";
import { TaskDueBadge } from "./task-due-badge";
import { TaskActorCluster } from "./task-meta";
import { TaskPriorityMark } from "./task-priority-mark";
import { TaskPrivateIndicator } from "./task-private-indicator";
import { TaskRunAtBadge } from "./task-run-at-badge";
import { TaskStatusAge } from "./task-status-age";
import { TaskStatusBadge } from "./task-status-badge";
import { TaskSubtaskProgress } from "./task-subtask-progress";
import { TaskTags } from "./task-tags";

interface TaskListItemProps {
  task: TaskWithCoworker;
  dragHandleProps?: DragHandleProps;
  isOverlay?: boolean;
  compact?: boolean;
  statusLabels?: Record<TaskStatus, string>;
}

export function TaskListItem({
  task,
  dragHandleProps,
  isOverlay = false,
  compact = false,
  statusLabels,
}: TaskListItemProps) {
  const t = useTranslations("App.Tasks");
  const hasName = task.name.trim().length > 0;
  const handleProps = dragHandleProps
    ? {
        ...dragHandleProps.attributes,
        ...dragHandleProps.listeners,
      }
    : null;

  const rowClassName = cn(
    // One line. The slots after the title have fixed widths, so the same
    // fact sits at the same place in every row. A narrow row keeps the
    // status and the people, and leaves tags, dates and the comment count
    // to the wide one, so the title keeps its room.
    "flex items-center gap-3 text-xs",
    // The list draws the surface and the hairlines. A row lifted out of it
    // by a drag brings its own box.
    "px-3 transition-colors",
    compact ? "py-1.5" : "py-2.5",
    "hover:bg-accent",
    "press content-in",
    (dragHandleProps?.isDragging || isOverlay) &&
      "bg-senary border-border rounded-lg border shadow-sm",
  );
  const row = (
    <>
      <span className="flex w-4 shrink-0 justify-center">
        <TaskPriorityMark priority={task.priority} />
      </span>
      <span className="text-muted-foreground w-20 shrink-0 truncate tabular-nums">
        {task.identifier}
      </span>
      <span
        className={cn(
          "line-clamp-1 min-w-0 text-sm font-medium",
          hasName ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {hasName ? task.name : t("noTitle")}
      </span>
      {/* Tags give way before the title does, down to a width that still
          reads, so a tag is never cut to one letter. They and the date show
          only where the title still has room beside them. */}
      <span className="hidden max-w-48 min-w-20 shrink-[3] overflow-x-clip xl:flex">
        <TaskTags
          tags={task.tags}
          showManualTopics={!compact}
          workspaceTags={task.workspaceTags}
          compact
          quiet
          inLink
        />
      </span>

      <span className="ms-auto flex shrink-0 items-center gap-4">
        <TaskPrivateIndicator visibility={task.visibility} />
        {task.statusSince && !task.isPending ? (
          <TaskStatusAge
            status={task.status}
            statusSince={task.statusSince}
            stuckOnly
          />
        ) : null}
        <TaskStatusBadge
          status={task.status}
          label={statusLabels?.[task.status]}
          className="w-40"
          plain
        />
        {/* One date, as on a board card: a scheduled Task says when it
            starts, and that it is late only once it is. */}
        <span className="hidden w-44 items-center gap-2 xl:flex">
          {task.runAt ? <TaskRunAtBadge runAt={task.runAt} /> : null}
          {task.dueOn ? (
            <TaskDueBadge
              dueOn={task.dueOn}
              status={task.status}
              overdueOnly={!!task.runAt}
            />
          ) : null}
        </span>
        {/* Sub-task progress has a column of its own, kept on a row with
            none, so the people after it line up. */}
        <span className="hidden w-14 shrink-0 overflow-x-clip xl:flex">
          <TaskSubtaskProgress progress={task.subtaskProgress} />
        </span>
        <span className="flex w-16 justify-end">
          <TaskActorCluster
            assignee={task.assignee}
            participants={task.participants}
          />
        </span>
        <span className="text-muted-foreground hidden w-8 items-center gap-1 xl:flex">
          {task.commentsCount > 0 ? (
            <>
              <MessageSquare className="size-3.5" aria-hidden />
              <span className="tabular-nums">{task.commentsCount}</span>
            </>
          ) : null}
        </span>
      </span>
    </>
  );

  return (
    <div
      className={cn(
        "group",
        dragHandleProps && "cursor-grab",
        (dragHandleProps?.isDragging || isOverlay || task.isPending) &&
          "opacity-60",
      )}
      {...handleProps}
    >
      {task.isPending ? (
        // No page to open yet: the row is plain content until the create lands.
        <div aria-busy className={rowClassName}>
          {row}
        </div>
      ) : (
        <TaskDetailLink href={taskHref(task)} className={rowClassName}>
          {row}
        </TaskDetailLink>
      )}
    </div>
  );
}
