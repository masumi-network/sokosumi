import { SokosumiJobStatus } from "@sokosumi/utils";
import Link from "next/link";
import { AgentIcon } from "@/components/agents/agent-icon";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { TimeAgo } from "@/components/time-ago";
import { makeAgentJobsChannelName } from "@/lib/ably";
import type { JobSummary } from "@/lib/clients/generated/core/types.gen";
import { getAgentName, getAgentResolvedIcon } from "@/lib/helpers/agent";
import type { CoreAgentDto } from "@/lib/types/core-dto";

import { TaskJobStatusBadge } from "./task-job-status-badge.client";
import {
  TaskJobStatusChannelProvider,
  TaskJobsRealtimeProvider,
} from "./task-jobs-realtime-provider.client";

interface TaskJobsProps {
  title: string;
  agents: CoreAgentDto[];
  jobs: JobSummary[];
  userId: string | null;
  locale?: string;
  emptyLabel: string;
  untitledLabel: string;
  unknownAgentLabel: string;
}

export function TaskJobs({
  title,
  agents,
  jobs,
  userId,
  locale = "en",
  emptyLabel,
  untitledLabel,
  unknownAgentLabel,
}: TaskJobsProps) {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
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
        const agent = agentsById.get(job.agentId);
        const agentName = agent ? getAgentName(agent) : unknownAgentLabel;
        const agentIconModel = {
          name: agentName,
          icon: agent ? getAgentResolvedIcon(agent) : null,
        };
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
              initialStatus={job.status as SokosumiJobStatus}
              jobType={job.jobType}
              className="shrink-0"
            />
          </TaskJobStatusChannelProvider>
        ) : (
          <JobStatusBadge
            status={job.status as SokosumiJobStatus}
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
                  <AgentIcon agent={agentIconModel} />
                  <p className="truncate text-xs font-medium">{agentName}</p>
                </div>

                <p className="text-muted-foreground shrink-0 text-xs sm:w-[96px] sm:text-right">
                  <TimeAgo date={job.createdAt} locale={locale} />
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
