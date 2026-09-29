"use client";

import { useTranslations } from "next-intl";

import type { TaskPriority } from "@/lib/clients/generated/core";

import { TaskPriorityIcon } from "./task-priority-icon";

/** Priority glyph for list rows and cards. Nothing for NONE, so unprioritised tasks stay quiet. */
export function TaskPriorityMark({
  priority,
  className,
}: {
  priority: TaskPriority;
  className?: string;
}) {
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
