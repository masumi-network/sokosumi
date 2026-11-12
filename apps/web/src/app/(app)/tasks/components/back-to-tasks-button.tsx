"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

import { useMountEffect } from "@/hooks/use-mount-effect";

import {
  getStoredTasksReturnPath,
  isCalendarReturnPath,
} from "./task-navigation";
import { useTasksReturnPath } from "./use-tasks-return-path";

interface BackToTasksButtonProps {
  label: string;
  /** Set on a task's own page: a task opened from the Calendar goes back there. */
  calendarLabel?: string;
}

export function BackToTasksButton({
  label,
  calendarLabel,
}: BackToTasksButtonProps) {
  const router = useRouter();
  const allowCalendar = calendarLabel !== undefined;
  const returnPath = useTasksReturnPath({ allowCalendar });

  useMountEffect(() => {
    router.prefetch(getStoredTasksReturnPath({ allowCalendar }));
  });

  const handleNavigate = () => {
    router.push(getStoredTasksReturnPath({ allowCalendar }));
  };

  return (
    <button
      type="button"
      className="text-muted-foreground press hover:text-foreground hidden items-center gap-1.5 text-sm transition-colors md:inline-flex"
      onClick={handleNavigate}
      onPointerEnter={() => router.prefetch(returnPath)}
      onFocus={() => router.prefetch(returnPath)}
    >
      <ArrowLeft className="size-4" />
      <span>
        {calendarLabel && isCalendarReturnPath(returnPath)
          ? calendarLabel
          : label}
      </span>
    </button>
  );
}
