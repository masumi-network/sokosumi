"use client";

import { useFormatter } from "next-intl";
import { useMemo, useState } from "react";

import { JobScheduleSelectionType, JobScheduleType } from "@/lib/types/job";
import { computeNextRun } from "@/lib/utils/cron";

export interface UseJobScheduleReturn {
  scheduleOpen: boolean;
  setScheduleOpen: (open: boolean) => void;
  scheduleSelection: JobScheduleSelectionType | null;
  setScheduleSelection: (selection: JobScheduleSelectionType | null) => void;
  timezoneOptions: string[];
  isScheduled: boolean;
  nextRunAt: Date | null;
  nextRunLabel: string | null;
}

export function useJobSchedule(): UseJobScheduleReturn {
  const formatter = useFormatter();

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleSelection, setScheduleSelection] =
    useState<JobScheduleSelectionType | null>(null);

  const timezoneOptions =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [Intl.DateTimeFormat().resolvedOptions().timeZone];

  const isScheduled = useMemo(() => {
    return (
      !!scheduleSelection && scheduleSelection.mode !== JobScheduleType.NOW
    );
  }, [scheduleSelection]);

  const nextRunAt: Date | null = useMemo(() => {
    if (!scheduleSelection) return null;
    if (scheduleSelection.mode === JobScheduleType.ONE_TIME) {
      if (!scheduleSelection.oneTimeLocalIso) return null;
      const parsed = new Date(scheduleSelection.oneTimeLocalIso);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (scheduleSelection.mode === JobScheduleType.CRON) {
      if (!scheduleSelection.cron) return null;
      return (
        computeNextRun({
          cron: scheduleSelection.cron,
          timezone: scheduleSelection.timezone,
        }) ?? null
      );
    }
    return null;
  }, [scheduleSelection]);

  const nextRunLabel = useMemo(() => {
    if (!nextRunAt || !scheduleSelection) return null;
    try {
      return formatter.dateTime(nextRunAt, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: scheduleSelection.timezone,
      });
    } catch {
      return nextRunAt.toLocaleString();
    }
  }, [nextRunAt, scheduleSelection, formatter]);

  return {
    scheduleOpen,
    setScheduleOpen,
    scheduleSelection,
    setScheduleSelection,
    timezoneOptions,
    isScheduled,
    nextRunAt,
    nextRunLabel,
  };
}
