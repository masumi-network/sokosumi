"use client";

import { parseTaskScheduleMetadata } from "@sokosumi/utils";
import { useFormatter, useTranslations } from "next-intl";

import {
  computeScheduleTitleInfo,
  formatScheduleTitle,
} from "@/components/schedules/format";
import { cn } from "@/lib/utils";
import {
  formatRunTimeLabel,
  type RunTimeLabelKey,
} from "@/lib/utils/run-time-label";
import { getScheduleIcon } from "@/lib/utils/schedule-icon";

const NEXT_RUN_LABEL_KEYS = {
  overdue: "overdue",
  inMinutes: "dueInMinutes",
  inHours: "dueInHours",
  tomorrowAt: "tomorrowAt",
  at: "nextRunAt",
} as const satisfies Record<RunTimeLabelKey, string>;

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
        computeScheduleTitleInfo(
          {
            scheduleType:
              scheduleMetadata.mode === "once" ? "ONE_TIME" : "CRON",
            cron:
              scheduleMetadata.mode === "recurring"
                ? scheduleMetadata.expr
                : null,
            timezone:
              scheduleMetadata.mode === "recurring"
                ? scheduleMetadata.timezone
                : "UTC",
          },
          formatter,
        ),
        t,
      )
    : null;

  const nextRunLabel = nextRunAt
    ? formatRunTimeLabel(nextRunAt, formatter, (key, values) =>
        t(`card.${NEXT_RUN_LABEL_KEYS[key]}`, values),
      )
    : null;

  if (variant === "card") {
    const ScheduleIcon = scheduleMetadata
      ? getScheduleIcon(scheduleMetadata.mode)
      : null;

    return (
      <div className={cn("flex items-center justify-between gap-2", className)}>
        {scheduleLabel && ScheduleIcon ? (
          <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            <ScheduleIcon className="size-3.5 shrink-0" aria-hidden />
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
