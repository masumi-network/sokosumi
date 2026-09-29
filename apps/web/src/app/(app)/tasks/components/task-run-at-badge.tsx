"use client";

import { CalendarClock } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { formatRunTimeLabel } from "@/lib/utils/run-time-label";

interface TaskRunAtBadgeProps {
  /** ISO Run at of a Queued Task. */
  runAt: string;
  className?: string;
}

/** When a Queued Task starts, relative while it is close. */
export function TaskRunAtBadge({ runAt, className }: TaskRunAtBadgeProps) {
  const t = useTranslations("App.Tasks.RunAt.badge");
  const formatter = useFormatter();
  const date = new Date(runAt);

  return (
    <span
      className={cn(
        "text-muted-foreground inline-flex min-w-0 items-center gap-1.5 text-xs",
        className,
      )}
    >
      <CalendarClock className="size-3.5 shrink-0" aria-hidden />
      {/* The relative label depends on the clock, which differs by render. */}
      <time
        dateTime={runAt}
        title={formatter.dateTime(date, "dateTimeWithYear")}
        className="truncate tabular-nums"
        suppressHydrationWarning
      >
        {formatRunTimeLabel(date, formatter, (key, values) => t(key, values))}
      </time>
    </span>
  );
}
