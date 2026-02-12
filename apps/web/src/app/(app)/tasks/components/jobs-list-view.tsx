"use client";

import { SokosumiJobStatus } from "@sokosumi/database";
import { useEffect, useMemo, useState } from "react";

import type { TasksViewJob } from "@/app/tasks/types/tasks-view-job";
import { COLUMN_STATUS_COLORS, type KanbanColumnId } from "@/lib/types/task";

import { ColumnHeader } from "./column-header";
import { JobListItem } from "./job-list-item";
import { type JobsFailedFilterMode } from "./jobs-filter-dropdown";

const JOBS_LAST_SEEN_AT_STORAGE_KEY = "sokosumi.tasks.jobs.lastSeenAt";
const RECENT_SECTION_COLOR_CLASS = "bg-violet-500";
const RECENT_RETENTION_MS = 1000 * 60 * 60 * 24;
export type { TasksViewJob } from "@/app/tasks/types/tasks-view-job";

interface JobsListViewProps {
  jobs: TasksViewJob[];
  agentPreviewById: Record<string, { name: string; icon: string | null }>;
  columnLabels: Record<KanbanColumnId, string>;
  failedFilterMode: JobsFailedFilterMode;
  labels: {
    filterButton: string;
    filterHideFailed: string;
    filterShowAll: string;
    recentTitle: string;
    emptyRecent: string;
    emptyList: string;
    emptySection: string;
    untitled: string;
    unknownAgent: string;
    unknownCoworker: string;
  };
}

export function JobsListView({
  jobs,
  agentPreviewById,
  columnLabels,
  failedFilterMode,
  labels,
}: JobsListViewProps) {
  const [lastSeenAt] = useState(() => {
    if (typeof window === "undefined") {
      return 0;
    }

    try {
      const rawValue = window.localStorage.getItem(
        JOBS_LAST_SEEN_AT_STORAGE_KEY,
      );
      const parsedValue = Number(rawValue);
      return Number.isFinite(parsedValue) ? parsedValue : 0;
    } catch {
      return 0;
    }
  });
  const [recentReferenceTs] = useState(() => Date.now());

  useEffect(() => {
    try {
      window.localStorage.setItem(
        JOBS_LAST_SEEN_AT_STORAGE_KEY,
        String(Date.now()),
      );
    } catch {
      // No-op when localStorage is unavailable.
    }
  }, []);

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort(
        (firstJob, secondJob) =>
          new Date(secondJob.createdAt).getTime() -
          new Date(firstJob.createdAt).getTime(),
      ),
    [jobs],
  );

  const visibleJobs = useMemo(
    () =>
      failedFilterMode === "hideFailed"
        ? sortedJobs.filter((job) => !isFailedLikeStatus(job.status))
        : sortedJobs,
    [failedFilterMode, sortedJobs],
  );

  const recentJobs = useMemo(
    () =>
      visibleJobs.filter((job) => {
        if (job.status !== SokosumiJobStatus.COMPLETED) return false;
        if (!job.completedAt) return false;
        const retentionFloor = recentReferenceTs - RECENT_RETENTION_MS;
        const effectiveLastSeenAt =
          lastSeenAt > 0
            ? Math.max(lastSeenAt, retentionFloor)
            : retentionFloor;
        return new Date(job.completedAt).getTime() > effectiveLastSeenAt;
      }),
    [lastSeenAt, recentReferenceTs, visibleJobs],
  );

  const recentJobIds = useMemo(
    () => new Set(recentJobs.map((job) => job.id)),
    [recentJobs],
  );

  const groupedJobs = useMemo(() => {
    const initial: Record<KanbanColumnId, TasksViewJob[]> = {
      backlog: [],
      todo: [],
      "in-progress": [],
      "input-required": [],
      complete: [],
    };

    for (const job of visibleJobs) {
      if (recentJobIds.has(job.id)) continue;
      const columnId = jobStatusToColumnId(job.status);
      initial[columnId].push(job);
    }

    return initial;
  }, [recentJobIds, visibleJobs]);

  const orderedColumns: KanbanColumnId[] = [
    "complete",
    "input-required",
    "in-progress",
    "todo",
  ];
  const hasAnyJobs = visibleJobs.length > 0;

  const listContent = (
    <div className="bg-muted/30 border-border/50 overflow-hidden rounded-xl border">
      {hasAnyJobs ? (
        <div className="divide-border/50 divide-y">
          <section className="flex flex-col gap-1">
            <div className="bg-muted/40 sticky top-0 z-10 px-4 py-2 backdrop-blur-sm">
              <ColumnHeader
                title={labels.recentTitle}
                count={recentJobs.length}
                statusColorClass={RECENT_SECTION_COLOR_CLASS}
              />
            </div>
            <div className="divide-border/50 flex flex-col divide-y">
              {recentJobs.length > 0 ? (
                recentJobs.map((job) => (
                  <JobListItem
                    key={job.id}
                    job={job}
                    agentPreview={agentPreviewById[job.agentId]}
                    labels={labels}
                  />
                ))
              ) : (
                <div className="text-muted-foreground px-4 py-3 text-sm">
                  {labels.emptyRecent}
                </div>
              )}
            </div>
          </section>

          {orderedColumns.map((columnId) => {
            const columnJobs = groupedJobs[columnId];

            return (
              <section key={columnId} className="flex flex-col gap-1">
                <div className="bg-muted/40 sticky top-0 z-10 px-4 py-2 backdrop-blur-sm">
                  <ColumnHeader
                    title={columnLabels[columnId]}
                    count={columnJobs.length}
                    statusColorClass={COLUMN_STATUS_COLORS[columnId]}
                  />
                </div>
                <div className="divide-border/50 flex flex-col divide-y">
                  {columnJobs.length > 0 ? (
                    columnJobs.map((job) => (
                      <JobListItem
                        key={job.id}
                        job={job}
                        agentPreview={agentPreviewById[job.agentId]}
                        labels={labels}
                      />
                    ))
                  ) : (
                    <div className="text-muted-foreground px-4 py-3 text-sm">
                      {labels.emptySection}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="text-muted-foreground/50 flex items-center justify-center py-16 text-sm">
          {labels.emptyList}
        </div>
      )}
    </div>
  );

  return listContent;
}

function jobStatusToColumnId(status: SokosumiJobStatus): KanbanColumnId {
  switch (status) {
    case SokosumiJobStatus.PAYMENT_PENDING:
    case SokosumiJobStatus.STARTED:
      return "todo";
    case SokosumiJobStatus.INPUT_REQUIRED:
      return "input-required";
    case SokosumiJobStatus.COMPLETED:
    case SokosumiJobStatus.FAILED:
    case SokosumiJobStatus.PAYMENT_FAILED:
    case SokosumiJobStatus.REFUND_RESOLVED:
    case SokosumiJobStatus.DISPUTE_RESOLVED:
      return "complete";
    case SokosumiJobStatus.PROCESSING:
    case SokosumiJobStatus.RESULT_PENDING:
    case SokosumiJobStatus.REFUND_PENDING:
    case SokosumiJobStatus.DISPUTE_PENDING:
    default:
      return "in-progress";
  }
}

function isFailedLikeStatus(status: SokosumiJobStatus): boolean {
  return (
    status === SokosumiJobStatus.FAILED ||
    status === SokosumiJobStatus.PAYMENT_FAILED
  );
}
