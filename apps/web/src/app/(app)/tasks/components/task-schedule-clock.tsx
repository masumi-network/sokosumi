"use client";

import { Clock } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo } from "react";

import { formatTaskScheduleSelectionLabel } from "@/components/schedules/format";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getDefaultTimezone } from "@/lib/schedules/timezones";
import { metadataToSelection } from "@/lib/utils/task-schedule";

interface TaskScheduleClockProps {
  metadata: string | null | undefined;
}

export function TaskScheduleClock({ metadata }: TaskScheduleClockProps) {
  const tSchedule = useTranslations("App.Tasks.Schedule");
  const formatter = useFormatter();

  const tooltipLabel = useMemo(() => {
    const selection = metadataToSelection(metadata, getDefaultTimezone());
    return formatTaskScheduleSelectionLabel(
      selection,
      (key, values) =>
        tSchedule(
          key as
            | "option.oneTime"
            | "option.custom"
            | "option.dailyWithTime"
            | "option.weeklyWithWeekdayTime"
            | "option.monthlyWithDayTime"
            | "option.dailyEveryNWithTime"
            | "option.weeklyListWithTime"
            | "option.monthlyEveryNWithDayTime"
            | "footer.oneTimeAt",
          values as Record<string, string | number | Date>,
        ),
      formatter,
    );
  }, [formatter, metadata, tSchedule]);

  if (!tooltipLabel) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground -m-1 shrink-0 rounded p-1"
          aria-label={tooltipLabel}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <Clock className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltipLabel}</TooltipContent>
    </Tooltip>
  );
}
