"use client";

import { SokosumiJobStatus } from "@sokosumi/utils";
import { useEffect, useMemo, useState } from "react";

import type { TasksViewJob } from "@/app/tasks/types/tasks-view-job";
import { COLUMN_STATUS_COLORS, type KanbanColumnId } from "@/lib/types/task";

import { ColumnHeader } from "./column-header";
import { JobListItem } from "./job-list-item";

const JOBS_LAST_SEEN_AT_STORAGE_KEY = "sokosumi.tasks.jobs.lastSeenAt";
const RECENT_SECTION_COLOR_CLASS = "bg-violet-500";
const RECENT_RETENTION_MS = 1000 * 60 * 60 * 24;

interface RecentJobsReference {
  lastSeenAt: number;
  referenceTs: number;
}

interface JobsListViewProps {
  jobs: TasksViewJob[];
  agentPreviewById: Record<string, { name: string; icon: string | null }>;
  columnLabels: Record<KanbanColumnId, string>;
  labels: {
    recentTitle: string;
    emptyRecent: string;
    emptyList: string;
    emptySection: string;
    untitled: string;
    unknownAgent: string;
  };
}

export function JobsListView({
  jobs,
  agentPreviewById,
  columnLabels,
  labels,
}: JobsListViewProps) {
  const [recentJobsReference, setRecentJobsReference] =
    useState<RecentJobsReference | null>(null);

  useEffect(() => {
    const referenceTs = Date.now();
    let lastSeenAt = 0;

    try {
      const rawValue = window.localStorage.getItem(
        JOBS_LAST_SEEN_AT_STORAGE_KEY,
      );
      const parsedValue = Number(rawValue);
      lastSeenAt = Number.isFinite(parsedValue) ? parsedValue : 0;

      window.localStorage.setItem(
        JOBS_LAST_SEEN_AT_STORAGE_KEY,
        String(referenceTs),
      );
    } catch {
      // No-op when localStorage is unavailable.
    }

    setRecentJobsReference({ lastSeenAt, referenceTs });
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

  const recentJobs = useMemo(() => {
    if (recentJobsReference === null) return [];

    return sortedJobs.filter((job) => {
      if (job.status !== SokosumiJobStatus.COMPLETED) return false;
      if (!job.completedAt) return false;
      const retentionFloor =
        recentJobsReference.referenceTs - RECENT_RETENTION_MS;
      const effectiveLastSeenAt =
        recentJobsReference.lastSeenAt > 0
          ? Math.max(recentJobsReference.lastSeenAt, retentionFloor)
          : retentionFloor;
      return new Date(job.completedAt).getTime() > effectiveLastSeenAt;
    });
  }, [recentJobsReference, sortedJobs]);

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
      done: [],
    };

    for (const job of sortedJobs) {
      if (recentJobIds.has(job.id)) continue;
      const columnId = jobStatusToColumnId(job.status);
      initial[columnId].push(job);
    }

    return initial;
  }, [recentJobIds, sortedJobs]);

  const orderedColumns: KanbanColumnId[] = [
    "done",
    "input-required",
    "in-progress",
    "todo",
  ];
  const hasAnyJobs = sortedJobs.length > 0;

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
      return "done";
    case SokosumiJobStatus.PROCESSING:
    case SokosumiJobStatus.RESULT_PENDING:
    case SokosumiJobStatus.REFUND_PENDING:
    case SokosumiJobStatus.DISPUTE_PENDING:
    default:
      return "in-progress";
  }
}
