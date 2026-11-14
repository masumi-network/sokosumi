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
  /** `row` matches the Task page's property rows; `card` fits boards and lists. */
  variant?: "card" | "row";
  className?: string;
}

/** How long a waiting Task has been in its status; says Stuck after a few days. */
export function TaskStatusAge({
  status,
  statusSince,
  variant = "card",
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
        "inline-flex min-w-0 items-center",
        variant === "row" ? "h-8 gap-2 text-sm" : "gap-1 text-xs",
        stuck ? "text-foreground font-medium" : "text-muted-foreground",
        className,
      )}
    >
      {variant === "row" ? (
        <span className="flex size-5 shrink-0 items-center justify-center">
          <Hourglass className="size-4" aria-hidden />
        </span>
      ) : (
        <Hourglass className="size-3.5 shrink-0" aria-hidden />
      )}
      <span className={stuck || variant === "row" ? undefined : "sr-only"}>
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
