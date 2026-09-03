"use client";

import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { SokosumiJobStatus, TaskStatus } from "@/lib/clients/generated/core";
import type { HistoryItem } from "@/lib/clients/generated/core/types.gen";

const SEARCH_STATUS_BADGE_CLASSNAME = "ml-auto shrink-0";

export function HistorySearchItemStatus({ item }: { item: HistoryItem }) {
  if (item.kind === "task") {
    const status = item.status as TaskStatus;
    return (
      <TaskStatusBadge
        status={status}
        className={SEARCH_STATUS_BADGE_CLASSNAME}
      />
    );
  }

  return (
    <JobStatusBadge
      status={item.status as SokosumiJobStatus}
      className={SEARCH_STATUS_BADGE_CLASSNAME}
    />
  );
}
