"use client";

import { ChannelProvider, useChannel } from "ably/react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { loadMoreOwnedAgentJobs } from "@/app/agents/[agentId]/jobs/actions";
import { getJobStatusDotColorClass } from "@/components/jobs/job-status-styles";
import { Button } from "@/components/ui/button";
import LazyAblyProvider from "@/contexts/lazy-ably-provider";
import { jobStatusDataSchema, makeAgentJobsChannelName } from "@/lib/ably";
import type { JobSummary } from "@/lib/clients/generated/core";
import { SokosumiJobStatus } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

import { buildJobDayGroups } from "./jobs-list.utils";
import { JobsSearch } from "./jobs-search";

const JOB_STATUS_EVENT_NAME = "job_status_data";

interface JobStatusUpdateData {
  jobId: string;
  jobStatus: SokosumiJobStatus;
  jobStatusSettled: boolean;
}

interface JobsListProps {
  jobs: JobSummary[];
  jobsNextCursor: string | null;
  userId: string;
  agentId: string;
  selectedJobId?: string;
}

function appendUniqueJobs(
  existing: JobSummary[],
  incoming: JobSummary[],
): JobSummary[] {
  const existingIds = new Set(existing.map((job) => job.id));
  const unique = incoming.filter((job) => !existingIds.has(job.id));
  return [...existing, ...unique];
}

function JobsStatusRealtimeListener({
  channelName,
  onStatusUpdate,
}: {
  channelName: string;
  onStatusUpdate: (updates: JobStatusUpdateData[]) => void;
}) {
  const animationFrameRef = useRef<number | null>(null);
  const pendingUpdatesRef = useRef<JobStatusUpdateData[]>([]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      pendingUpdatesRef.current = [];
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useChannel(channelName, JOB_STATUS_EVENT_NAME, (message) => {
    const parsedResult = jobStatusDataSchema.safeParse(message.data);
    if (!parsedResult.success) {
      console.error("Failed to parse JobStatus from message", {
        channelName,
        messageName: message.name,
        messageData: message.data,
        error: parsedResult.error,
      });
      return;
    }

    pendingUpdatesRef.current.push({
      jobId: parsedResult.data.jobId,
      jobStatus: parsedResult.data.jobStatus,
      jobStatusSettled: parsedResult.data.jobStatusSettled,
    });

    if (animationFrameRef.current !== null) {
      return;
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      if (!isMountedRef.current) {
        pendingUpdatesRef.current = [];
        return;
      }

      const updates = pendingUpdatesRef.current;
      pendingUpdatesRef.current = [];
      if (updates.length === 0) {
        return;
      }

      onStatusUpdate(updates);
    });
  });

  return null;
}

export function JobsList({
  jobs,
  jobsNextCursor,
  userId,
  agentId,
  selectedJobId,
}: JobsListProps) {
  const t = useTranslations("Components.Jobs.JobsList");
  const { locale } = useLocalizedDateTime();
  const routeParams = useParams<{ jobId?: string }>();
  const router = useRouter();
  const [localJobs, setLocalJobs] = useState<JobSummary[]>(jobs);
  const [filteredJobs, setFilteredJobs] = useState<JobSummary[]>(jobs);
  const [nextCursor, setNextCursor] = useState(jobsNextCursor);
  const [isLoadingMore, startLoadMoreTransition] = useTransition();
  const hasAppendedViaLoadMoreRef = useRef(false);
  const activeJobId = selectedJobId ?? routeParams.jobId;

  // Sync when jobs prop changes; keep load-more history (R7).
  useEffect(() => {
    setLocalJobs((prev) => {
      if (!hasAppendedViaLoadMoreRef.current) {
        return jobs;
      }
      const firstPageIds = new Set(jobs.map((job) => job.id));
      const older = prev.filter((job) => !firstPageIds.has(job.id));
      return [...jobs, ...older];
    });
    setNextCursor((prev) =>
      hasAppendedViaLoadMoreRef.current ? prev : jobsNextCursor,
    );
  }, [jobs, jobsNextCursor]);

  const dayGroups = useMemo(
    () => buildJobDayGroups(filteredJobs, locale),
    [filteredJobs, locale],
  );

  const channelName = makeAgentJobsChannelName(agentId, userId);

  function handleStatusUpdate(updates: JobStatusUpdateData[]) {
    if (updates.length === 0) {
      return;
    }

    const latestByJobId = new Map<string, JobStatusUpdateData>();
    for (const update of updates) {
      latestByJobId.set(update.jobId, update);
    }

    const completedAtFallback = new Date();
    const updater = (prev: JobSummary[]) =>
      prev.map((job) => {
        const update = latestByJobId.get(job.id);
        if (!update) {
          return job;
        }

        const statusUnchanged = job.status === update.jobStatus;
        const settledUnchanged =
          job.jobStatusSettled === update.jobStatusSettled;
        if (statusUnchanged && settledUnchanged) {
          return job;
        }

        return {
          ...job,
          status: update.jobStatus,
          jobStatusSettled: update.jobStatusSettled,
          ...(update.jobStatus === SokosumiJobStatus.COMPLETED &&
            job.completedAt === null && { completedAt: completedAtFallback }),
        };
      });

    setLocalJobs(updater);
    setFilteredJobs(updater);
  }

  function handleJobClick(job: JobSummary) {
    const qs = new URLSearchParams(window.location.search).toString();
    const base = `/agents/${job.agentId}/jobs/${job.id}`;
    router.push(qs ? `${base}?${qs}` : base);
  }

  function handleLoadMore() {
    if (!nextCursor || isLoadingMore) {
      return;
    }
    const cursor = nextCursor;
    startLoadMoreTransition(async () => {
      try {
        const result = await loadMoreOwnedAgentJobs(agentId, cursor);
        hasAppendedViaLoadMoreRef.current = true;
        setLocalJobs((prev) => appendUniqueJobs(prev, result.jobs));
        setNextCursor(result.nextCursor);
      } catch {
        toast.error(t("loadMoreError"));
      }
    });
  }

  return (
    <>
      <LazyAblyProvider>
        <ChannelProvider channelName={channelName}>
          <JobsStatusRealtimeListener
            channelName={channelName}
            onStatusUpdate={handleStatusUpdate}
          />
        </ChannelProvider>
      </LazyAblyProvider>
      <aside className="lg:border-border flex h-full min-h-0 w-full flex-col py-4 lg:w-72 lg:border-r">
        <JobsSearch
          jobs={localJobs}
          onFilteredChange={(nextJobs) => setFilteredJobs(nextJobs)}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-24 md:p-2 md:pr-4 md:pl-0 lg:pb-2">
          {dayGroups.length > 0 ? (
            dayGroups.map((group) => (
              <section key={group.key} className="mb-4">
                <div className="text-muted-foreground px-2 pb-2 text-xs font-medium capitalize">
                  {group.key}
                </div>
                <ul className="space-y-2">
                  {group.jobs.map((job) => (
                    <li key={job.id}>
                      <JobRow
                        job={job}
                        selected={activeJobId === job.id}
                        onClick={handleJobClick}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <div className="text-muted-foreground px-2 py-8 text-sm">
              {t("emptyJobs")}
            </div>
          )}
          {nextCursor ? (
            <div className="flex justify-center px-2 pb-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-muted-foreground hover:text-foreground w-full text-xs"
                disabled={isLoadingMore}
                onClick={handleLoadMore}
              >
                {isLoadingMore ? t("loading") : t("loadMore")}
              </Button>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}

export function JobRow({
  job,
  selected,
  onClick,
}: {
  job: JobSummary;
  selected: boolean;
  onClick: (job: JobSummary) => void;
}) {
  const { formatTimeAgo } = useLocalizedDateTime();

  return (
    <button
      type="button"
      onClick={() => onClick(job)}
      className={cn(
        "hover:bg-muted bg-muted/30 w-full rounded-md px-2 py-2 text-left transition-colors",
        selected && "bg-primary text-primary-foreground hover:bg-primary/90",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            getJobStatusDotColorClass(job.status),
          )}
          aria-hidden
        />
        <span className="truncate text-sm font-medium">
          {job.name ?? job.id}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between pl-4">
        <p
          className={cn(
            "text-muted-foreground truncate text-xs",
            selected && "text-primary-foreground/80",
          )}
        >
          {formatTimeAgo(job.createdAt)}
        </p>
      </div>
    </button>
  );
}
