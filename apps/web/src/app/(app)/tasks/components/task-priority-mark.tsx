"use client";

import type { TaskPriority } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";

import { TaskPriorityIcon } from "./task-priority-icon";

interface TaskPriorityMarkProps {
  priority: TaskPriority;
  className?: string;
}

/** Priority glyph for list rows and cards. Nothing for NONE, so unprioritised tasks stay quiet. */
export function TaskPriorityMark({
  priority,
  className,
}: TaskPriorityMarkProps) {
  const t = useTranslations("App.Tasks.Priority.levels");
  if (priority === "NONE") return null;

  return (
    <TaskPriorityIcon
      priority={priority}
      label={t(priority)}
      className={className}
    />
  );
}
