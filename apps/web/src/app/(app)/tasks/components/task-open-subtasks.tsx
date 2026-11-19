"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext } from "react";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { taskHref } from "@/app/tasks/utils/task-href";
import { cn } from "@/lib/utils";
import { TaskDetailLink } from "./task-detail-link";
import { TaskStatusBadge } from "./task-status-badge";

/** The view options switch: list each Task's open sub-tasks under it. */
export const ShowOpenSubtasksContext = createContext(false);

interface TaskOpenSubtasksProps {
  task: Pick<
    TaskWithCoworker,
    "id" | "identifier" | "name" | "subtaskProgress" | "openSubtasks"
  >;
  className?: string;
}

/**
 * The first open sub-tasks, indented under their Task, then how many more
 * are open. Done ones stay in the progress count. Each row opens its
 * sub-task; "+ N more" opens the Task.
 */
export function TaskOpenSubtasks({ task, className }: TaskOpenSubtasksProps) {
  const show = useContext(ShowOpenSubtasksContext);
  const t = useTranslations("App.Tasks.Subtasks");
  const tTasks = useTranslations("App.Tasks");
  const tStatus = useTranslations("App.Tasks.Filters.statusOptions");
  const open = task.openSubtasks ?? [];
  if (!show || open.length === 0) return null;

  const progress = task.subtaskProgress;
  const notShown = progress
    ? Math.max(0, progress.total - progress.completed - open.length)
    : 0;
  // Above the card's full-size title link, so each row is its own link.
  const nameOf = (name: string) => (name.trim() ? name : tTasks("noTitle"));
  const linkClassName =
    "relative z-10 flex min-w-0 items-center gap-1.5 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <ul
      aria-label={t("openListLabel", { name: nameOf(task.name) })}
      className={cn(
        "border-border ms-1 space-y-1 border-s-2 ps-2.5 text-xs",
        className,
      )}
    >
      {open.map((subtask) => (
        <li key={subtask.id}>
          <TaskDetailLink href={taskHref(subtask)} className={linkClassName}>
            <TaskStatusBadge
              status={subtask.status}
              label={tStatus(subtask.status)}
              showLabel={false}
              plain
            />
            <span className="truncate">{nameOf(subtask.name)}</span>
          </TaskDetailLink>
        </li>
      ))}
      {notShown > 0 ? (
        <li>
          <TaskDetailLink
            href={taskHref(task)}
            className={cn(linkClassName, "text-muted-foreground")}
          >
            {t("moreOpen", { count: notShown })}
          </TaskDetailLink>
        </li>
      ) : null}
    </ul>
  );
}
