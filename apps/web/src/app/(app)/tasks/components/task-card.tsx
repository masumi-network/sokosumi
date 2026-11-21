"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { TASK_CARD_DENSITY_CLASS } from "@/app/tasks/constants";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { taskHref } from "@/app/tasks/utils/task-href";
import type { TaskStatus as TaskStatusType } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";
import { TaskDetailLink } from "./task-detail-link";
import type { DragHandleProps } from "./task-dnd";
import { TaskDueBadge } from "./task-due-badge";
import { TaskMentionMark } from "./task-mention-mark";
import { TaskMetaDetails } from "./task-meta";
import { TaskOpenSubtasks } from "./task-open-subtasks";
import { TaskPriorityMark } from "./task-priority-mark";
import { TaskPrivateIndicator } from "./task-private-indicator";
import { TaskRunAtBadge } from "./task-run-at-badge";
import { TaskStatusAge } from "./task-status-age";
import { TaskStatusBadge } from "./task-status-badge";
import { TaskSubtaskProgress } from "./task-subtask-progress";
import { TaskTags } from "./task-tags";

/** Only the display fields shared by task boards and recorded chat results. */
export interface TaskCardData
  extends Pick<
    TaskWithCoworker,
    | "id"
    | "isPending"
    | "identifier"
    | "name"
    | "status"
    | "priority"
    | "visibility"
    | "project"
    | "createdAt"
    | "assignee"
    | "participants"
    | "commentsCount"
    | "tags"
    | "workspaceTags"
    | "runAt"
    | "dueOn"
    | "statusSince"
    | "subtaskProgress"
    | "openSubtasks"
    | "hasUnansweredMention"
  > {}
interface TaskCardProps {
  task: TaskCardData;
  dragHandleProps?: DragHandleProps;
  compact?: boolean;
  statusLabels?: Record<TaskStatusType, string>;
  /**
   * The status the surrounding column already names. A card in that status
   * shows the marker without the word. Unset outside a board column.
   */
  quietStatus?: TaskStatusType;
}

export function TaskCard({
  task,
  dragHandleProps,
  compact = false,
  statusLabels,
  quietStatus,
}: TaskCardProps) {
  const t = useTranslations("App.Tasks.Tags");
  const tTasks = useTranslations("App.Tasks");
  const hasName = task.name.trim().length > 0;
  const name = hasName ? task.name : tTasks("noTitle");
  const handleProps = dragHandleProps?.listeners;
  return (
    <div
      className={cn(
        "group",
        dragHandleProps && "cursor-grab",
        (dragHandleProps?.isDragging || task.isPending) && "opacity-60",
      )}
      aria-busy={task.isPending || undefined}
      {...handleProps}
    >
      <article
        data-intent-area
        className={cn(
          "bg-background border-border relative isolate rounded-lg border transition-[border-color,box-shadow,transform] hover:border-control-border hover:shadow-sm press content-in",
          TASK_CARD_DENSITY_CLASS[compact ? "compact" : "normal"],
          dragHandleProps?.isDragging && "shadow-lg",
        )}
      >
        {/* One line: a long status label truncates before anything wraps. */}
        <div className="flex h-4 items-center gap-2 text-xs">
          <TaskStatusBadge
            status={task.status}
            label={statusLabels?.[task.status]}
            showLabel={task.status !== quietStatus}
            plain
          />
          {task.identifier && task.project && !task.isPending ? (
            // The identifier's prefix is the project, so it is the way there.
            <Link
              href={`/projects/${task.project.id}`}
              // The name starts with what is shown and then says where it goes.
              aria-label={`${task.identifier}, ${t("openProject", { name: task.project.name })}`}
              title={task.project.name}
              // Taller than its text by the row gap, and no taller: a larger
              // target would take taps and drags meant for the title.
              className="text-muted-foreground hover:text-foreground focus-visible:outline-ring relative z-10 -my-1 shrink-0 rounded-sm py-1 tabular-nums hover:underline focus-visible:outline-2"
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {task.identifier}
            </Link>
          ) : task.identifier ? (
            <span className="text-muted-foreground shrink-0 tabular-nums">
              {task.identifier}
            </span>
          ) : task.project ? null : (
            // No project means no identifier, so the row says why it is bare.
            // In a full row it gives way long before the status label does.
            <span className="text-muted-foreground min-w-0 shrink-[99] truncate">
              {t("noProject")}
            </span>
          )}
          <TaskPriorityMark priority={task.priority} className="size-3.5" />
          <span className="ms-auto flex shrink-0 items-center gap-2">
            {task.statusSince && !task.isPending ? (
              <TaskStatusAge
                status={task.status}
                statusSince={task.statusSince}
                stuckOnly
              />
            ) : null}
            <TaskMentionMark show={task.hasUnansweredMention} />
            <TaskPrivateIndicator visibility={task.visibility} />
          </span>
        </div>
        <h3
          className={cn(
            "text-sm leading-5 font-medium",
            // A stand-in is quieter than a title someone wrote.
            hasName ? "text-foreground" : "text-muted-foreground",
            compact ? "line-clamp-1" : "line-clamp-2",
          )}
        >
          {task.isPending ? (
            name
          ) : (
            <TaskDetailLink
              href={taskHref(task)}
              title={name}
              className="outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {name}
            </TaskDetailLink>
          )}
        </h3>
        {/* One line. A container, so the tag can leave a narrow card and the
            date can truncate there, and so the line's unwrapped width cannot
            widen a column that sizes to its content. */}
        <div className="@container flex h-5 items-center gap-2">
          {/* A scheduled Task says when it starts, and that it is late only
              once it is. Any other Task says when it is due. */}
          {task.runAt ? <TaskRunAtBadge runAt={task.runAt} /> : null}
          {task.dueOn ? (
            <TaskDueBadge
              dueOn={task.dueOn}
              status={task.status}
              overdueOnly={!!task.runAt}
              // Alone it stays whole. Beside a start time both give way.
              className={task.runAt ? undefined : "@min-[14rem]:shrink-0"}
            />
          ) : null}
          <TaskSubtaskProgress
            progress={task.subtaskProgress}
            className="shrink-0"
          />
          {/* A start time is long, so it takes the tag's place. Clips, so a
              tag squeezed by its neighbours never runs under the comment
              count; the end padding keeps the count button's focus ring. */}
          {task.runAt ? null : (
            <div
              className={cn(
                "min-w-0 overflow-x-clip pe-1",
                // Beside a date the tag needs a wide card, or the date and the
                // faces squeeze it to nothing. In pixels like the column
                // width, so a larger browser font does not hide it.
                task.dueOn ? "hidden @min-[288px]:flex" : "flex",
              )}
            >
              <TaskTags
                tags={task.tags}
                showManualTopics={!compact}
                workspaceTags={task.workspaceTags}
                compact
                quiet
              />
            </div>
          )}
          <TaskMetaDetails
            project={null}
            assignee={task.assignee}
            participants={task.participants}
            commentsCount={task.commentsCount}
          />
        </div>
        <TaskOpenSubtasks task={task} />
      </article>
    </div>
  );
}
