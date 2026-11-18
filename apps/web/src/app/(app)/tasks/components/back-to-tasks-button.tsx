"use client";

import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import type { MouseEvent } from "react";

import { BackLink } from "@/components/back-link";

import {
  getStoredTasksReturnPath,
  isCalendarReturnPath,
} from "./task-navigation";
import { useTasksReturnPath } from "./use-tasks-return-path";

const TASKS_PATH = "/tasks";

interface BackToTasksButtonProps {
  label: string;
  /** Set on a task's own page: a task opened from the Calendar goes back there. */
  calendarLabel?: string;
  /** False where the board is not the likely next page. */
  loadOnMount?: boolean;
}

export function BackToTasksButton({
  label,
  calendarLabel,
  loadOnMount = true,
}: BackToTasksButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const allowCalendar = calendarLabel !== undefined;
  const returnPath = useTasksReturnPath({ allowCalendar });
  const taskPath = allowCalendar ? pathname : undefined;

  const handleNavigate = (event: MouseEvent<HTMLAnchorElement>) => {
    // A modified click opens a new tab or window from the link's href.
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    // Read storage at click time: `returnPath` state can lag behind the
    // TaskDetailLink click that wrote it.
    event.preventDefault();
    router.push(getStoredTasksReturnPath({ taskPath }));
  };

  return (
    <BackLink
      href={returnPath ?? TASKS_PATH}
      prefetchOnMount={loadOnMount && returnPath !== null}
      className="text-muted-foreground press hover:text-foreground hidden items-center gap-1.5 text-sm transition-colors md:inline-flex"
      onClick={handleNavigate}
    >
      <ArrowLeft className="size-4" />
      <span>
        {calendarLabel && returnPath && isCalendarReturnPath(returnPath)
          ? calendarLabel
          : label}
      </span>
    </BackLink>
  );
}
