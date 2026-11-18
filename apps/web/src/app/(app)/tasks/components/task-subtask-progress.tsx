"use client";

import type { TaskSubtaskProgress as Progress } from "@sokosumi/core-client";
import { ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

interface TaskSubtaskProgressProps {
  progress: Progress | undefined;
  className?: string;
}

/** "3/5" next to the due date. Nothing for a Task without sub-tasks. */
export function TaskSubtaskProgress({
  progress,
  className,
}: TaskSubtaskProgressProps) {
  const t = useTranslations("App.Tasks.Subtasks");
  if (!progress || progress.total === 0) return null;
  const done = progress.completed === progress.total;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs tabular-nums",
        done ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      <ListChecks className="size-3.5 shrink-0" aria-hidden />
      <span aria-hidden>
        {progress.completed}/{progress.total}
      </span>
      <span className="sr-only">
        {t("progressLabel", {
          completed: progress.completed,
          total: progress.total,
        })}
      </span>
    </span>
  );
}
