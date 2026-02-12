import { Sparkles } from "lucide-react";
import Link from "next/link";

import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { makeAgentJobsChannelName } from "@/lib/ably";
import type { TaskWithEvents } from "@/lib/services/task.service";
import { formatTimeAgo } from "@/lib/utils/datetime";

import { TaskJobStatusBadge } from "./task-job-status-badge.client";
import {
  TaskJobsRealtimeProvider,
  TaskJobStatusChannelProvider,
} from "./task-jobs-realtime-provider.client";

interface AgentPreview {
  name: string;
  icon: string | null;
}

interface TaskJobsProps {
  title: string;
  jobs: TaskWithEvents["jobs"];
  userId: string | null;
  agentPreviewById: Map<string, AgentPreview>;
  emptyLabel: string;
  untitledLabel: string;
  unknownAgentLabel: string;
}

export function TaskJobs({
  title,
  jobs,
  userId,
  agentPreviewById,
  emptyLabel,
  untitledLabel,
  unknownAgentLabel,
}: TaskJobsProps) {
  const sortedJobs = [...jobs].sort((firstJob, secondJob) => {
    return (
      new Date(secondJob.createdAt).getTime() -
      new Date(firstJob.createdAt).getTime()
    );
  });

  const jobsList = (
    <ul className="space-y-3">
      {sortedJobs.map((job) => {
        const name = job.name?.trim() ? job.name : untitledLabel;
        const agentPreview = agentPreviewById.get(job.agentId);
        const agentName = agentPreview?.name ?? unknownAgentLabel;
        const agentIcon = agentPreview?.icon ?? null;
        const href = `/agents/${job.agentId}/jobs/${job.id}`;
        const channelName = userId
          ? makeAgentJobsChannelName(job.agentId, userId)
          : null;

        const statusBadge = channelName ? (
          <TaskJobStatusChannelProvider channelName={channelName}>
            <TaskJobStatusBadge
              key={`${job.id}-${job.status}-real-time-badge`}
              channelName={channelName}
              jobId={job.id}
              initialStatus={job.status}
              jobType={job.jobType}
              className="shrink-0"
            />
          </TaskJobStatusChannelProvider>
        ) : (
          <JobStatusBadge
            status={job.status}
            jobType={job.jobType}
            className="shrink-0"
          />
        );

        return (
          <li key={job.id}>
            <Link
              href={href}
              className="bg-muted/40 border-border/50 hover:bg-muted/60 block rounded-lg border p-3 transition-colors"
            >
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_120px_96px] sm:items-center sm:gap-4">
                <p className="truncate text-sm">{name}</p>

                <div className="text-xs sm:w-[120px]">{statusBadge}</div>

                <div className="flex min-w-0 items-center gap-2 sm:w-[120px]">
                  <Avatar className="size-6 shrink-0">
                    {agentIcon ? (
                      <AvatarImage
                        src={agentIcon}
                        alt={agentName}
                        className="object-cover"
                      />
                    ) : null}
                    <AvatarFallback className="text-[10px] font-medium">
                      <Sparkles
                        strokeWidth={1}
                        className="size-3"
                        aria-hidden
                      />
                    </AvatarFallback>
                  </Avatar>
                  <p className="truncate text-xs font-medium">{agentName}</p>
                </div>

                <p className="text-muted-foreground shrink-0 text-xs sm:w-[96px] sm:text-right">
                  {formatTimeAgo(job.createdAt)}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <section className="space-y-4">
      <h2 className="text-muted-foreground/60 text-xs font-medium">{title}</h2>

      {sortedJobs.length === 0 ? (
        <p className="text-muted-foreground text-sm">{emptyLabel}</p>
      ) : userId ? (
        <TaskJobsRealtimeProvider>{jobsList}</TaskJobsRealtimeProvider>
      ) : (
        jobsList
      )}
    </section>
  );
}
