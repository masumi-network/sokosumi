"use client";

import { Hourglass } from "lucide-react";
import { useNow, useTranslations } from "next-intl";

import { getColumnId, WAITING_COLUMN_IDS } from "@/app/tasks/utils/task-column";
import { stuckCutoff } from "@/app/tasks/utils/tasks-filters";
import { TimeAgo } from "@/components/time-ago";
import type { TaskStatus } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";

interface TaskStatusAgeProps {
  status: TaskStatus;
  /** ISO time the Task last changed status. */
  statusSince: string;
  className?: string;
}

/** How long a waiting Task has been in its status; says Stuck after a few days. */
export function TaskStatusAge({
  status,
  statusSince,
  className,
}: TaskStatusAgeProps) {
  const t = useTranslations("App.Tasks.StatusAge");
  // Ticks so a card left open turns Stuck without a reload.
  const now = useNow({ updateInterval: 60_000 });
  if (!WAITING_COLUMN_IDS.includes(getColumnId(status))) return null;
  const stuck = new Date(statusSince) < stuckCutoff(now);

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1 text-xs",
        stuck ? "text-foreground font-medium" : "text-muted-foreground",
        className,
      )}
    >
      <Hourglass className="size-3.5 shrink-0" aria-hidden />
      <span className={stuck ? undefined : "sr-only"}>
        {stuck ? t("stuck") : t("label")}
      </span>
      <TimeAgo
        date={statusSince}
        addSuffix={false}
        strict
        titlePrefix={t("since")}
        className="truncate tabular-nums"
      />
    </span>
  );
}
