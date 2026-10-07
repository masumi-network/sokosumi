"use client";

import type { HistoryItem } from "@sokosumi/core-client";
import { SokosumiJobStatus, TaskStatus } from "@sokosumi/core-client";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";

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

  // Before the job badge, and for the same reason `HistoryStatus` in
  // `history-list-item.tsx` has the same branch: an image has no lifecycle of
  // its own, so Core types its status as the literal `"active"`, which
  // `JobStatusBadge` has no case for and labels "Unknown". Every generated
  // image in the palette wore that word.
  //
  // Two components deciding this separately is how it shipped: the feed row was
  // fixed and this one was not. If a fourth history kind arrives, both need the
  // branch — grep for `item.kind === "task"` to find them.
  if (item.kind === "image") {
    return null;
  }

  return (
    <JobStatusBadge
      status={item.status as SokosumiJobStatus}
      className={SEARCH_STATUS_BADGE_CLASSNAME}
    />
  );
}
