"use client";

import { Clock } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import {
  computeScheduleTitleInfo,
  formatScheduleTitle,
} from "@/components/schedules/format";
import { cn } from "@/lib/utils";
import { parseTaskScheduleMetadata } from "@/lib/utils/task-schedule";

interface TaskScheduleDisplayProps {
  metadata: string | null | undefined;
  nextRunAt: Date | null | undefined;
  className?: string;
  variant?: "stacked" | "card";
}

export function TaskScheduleDisplay({
  metadata,
  nextRunAt,
  className,
  variant = "stacked",
}: TaskScheduleDisplayProps) {
  const t = useTranslations("App.Tasks.Schedule");
  const formatter = useFormatter();
  const scheduleMetadata = parseTaskScheduleMetadata(metadata);

  if (!scheduleMetadata && !nextRunAt) {
    return null;
  }

  const scheduleLabel = scheduleMetadata
    ? formatScheduleTitle(
        computeScheduleTitleInfo({
          scheduleType: scheduleMetadata.mode === "once" ? "ONE_TIME" : "CRON",
          cron:
            scheduleMetadata.mode === "recurring"
              ? scheduleMetadata.expr
              : null,
          timezone:
            scheduleMetadata.mode === "recurring"
              ? scheduleMetadata.timezone
              : "UTC",
        }),
        (key, values) =>
          t(
            key as
              | "option.oneTime"
              | "option.dailyWithTime"
              | "option.weeklyWithWeekdayTime"
              | "option.monthlyWithDayTime"
              | "option.custom",
            values as Record<string, string | number | Date>,
          ),
      )
    : null;

  const nextRunLabel = nextRunAt
    ? formatNextRunLabel(nextRunAt, formatter, (key, values) =>
        t(
          key as
            | "card.overdue"
            | "card.dueInMinutes"
            | "card.dueInHours"
            | "card.tomorrowAt"
            | "card.nextRunAt",
          values as Record<string, string | number | Date>,
        ),
      )
    : null;

  if (variant === "card") {
    return (
      <div className={cn("flex items-center justify-between gap-2", className)}>
        {scheduleLabel ? (
          <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            <Clock className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{scheduleLabel}</span>
          </p>
        ) : null}
        {nextRunLabel ? (
          <p className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {nextRunLabel}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={className}>
      {scheduleLabel ? (
        <p className="text-muted-foreground text-xs">{scheduleLabel}</p>
      ) : null}
      {nextRunLabel ? (
        <p className="text-muted-foreground text-xs tabular-nums">
          {nextRunLabel}
        </p>
      ) : null}
    </div>
  );
}

function formatNextRunLabel(
  nextRunAt: Date,
  formatter: ReturnType<typeof useFormatter>,
  t: (key: string, values?: Record<string, unknown>) => string,
): string {
  const now = Date.now();
  const diffMs = nextRunAt.getTime() - now;

  if (diffMs <= 0) {
    return t("card.overdue");
  }

  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;

  if (diffMs < oneHour) {
    const minutes = Math.max(1, Math.ceil(diffMs / (60 * 1000)));
    return t("card.dueInMinutes", { minutes });
  }

  if (diffMs < oneDay) {
    const hours = Math.max(1, Math.ceil(diffMs / oneHour));
    return t("card.dueInHours", { hours });
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    nextRunAt.getFullYear() === tomorrow.getFullYear() &&
    nextRunAt.getMonth() === tomorrow.getMonth() &&
    nextRunAt.getDate() === tomorrow.getDate();

  if (isTomorrow) {
    return t("card.tomorrowAt", {
      time: formatter.dateTime(nextRunAt, {
        hour: "numeric",
        minute: "2-digit",
      }),
    });
  }

  return t("card.nextRunAt", {
    datetime: formatter.dateTime(nextRunAt, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
  });
}
