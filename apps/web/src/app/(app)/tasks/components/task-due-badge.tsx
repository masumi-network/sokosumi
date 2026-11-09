"use client";

import { CalendarCheck, CalendarX } from "lucide-react";
import { useFormatter, useNow, useTimeZone, useTranslations } from "next-intl";

import {
  DUE_DAY_FORMAT,
  dayInTimeZone,
  dueDayDate,
  isTaskOverdue,
} from "@/app/tasks/utils/task-due";
import type { TaskStatus } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";

interface TaskDueBadgeProps {
  /** `YYYY-MM-DD`. */
  dueOn: string;
  status: TaskStatus;
  /** `row` matches the Task page's Properties rows: text-sm, icon in a 20px slot. */
  variant?: "inline" | "row";
  className?: string;
}

/** The day a Task should be done by; says Overdue once that day has passed. */
export function TaskDueBadge({
  dueOn,
  status,
  variant = "inline",
  className,
}: TaskDueBadgeProps) {
  const t = useTranslations("App.Tasks.Due");
  const formatter = useFormatter();
  const today = dayInTimeZone(useNow(), useTimeZone());
  const date = formatter.dateTime(dueDayDate(dueOn), DUE_DAY_FORMAT);
  const overdue = isTaskOverdue(dueOn, status, today);
  const Icon = overdue ? CalendarX : CalendarCheck;

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center",
        variant === "row" ? "gap-2 text-sm" : "gap-1.5 text-xs",
        overdue ? "text-foreground font-medium" : "text-muted-foreground",
        className,
      )}
    >
      {variant === "row" ? (
        <span className="flex size-5 shrink-0 items-center justify-center">
          <Icon className="size-4" aria-hidden />
        </span>
      ) : (
        <Icon className="size-3.5 shrink-0" aria-hidden />
      )}
      <time dateTime={dueOn} className="truncate">
        {overdue ? t("overdue", { date }) : t("due", { date })}
      </time>
    </span>
  );
}
