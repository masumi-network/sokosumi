"use client";

import Link from "next/link";
import { useLocale } from "next-intl";

import type { TasksViewJob } from "@/app/tasks/types/tasks-view-job";
import { AgentIcon } from "@/components/agents/agent-icon";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { TimeAgo } from "@/components/time-ago";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface JobListItemLabels {
  untitled: string;
  unknownAgent: string;
}

interface JobListItemProps {
  job: TasksViewJob;
  agentPreview?: {
    name: string;
    icon: string | null;
  };
  labels: JobListItemLabels;
}

export function JobListItem({ job, agentPreview, labels }: JobListItemProps) {
  const locale = useLocale();
  const name = job.name?.trim() ? job.name : labels.untitled;
  const agentName = agentPreview?.name ?? labels.unknownAgent;
  const agentIconModel = {
    name: agentName,
    icon: agentPreview?.icon ?? null,
  };
  const coworkerName = job.coworker?.name?.trim() || null;
  const coworkerImage = job.coworker?.image ?? null;
  const href = `/agents/${job.agentId}/jobs/${job.id}`;
  const statusBadge = (
    <JobStatusBadge status={job.status} className="shrink-0" />
  );

  const agentCell = (
    <div className="flex min-w-0 items-center gap-2">
      <AgentIcon agent={agentIconModel} />
      <Tooltip>
        <TooltipTrigger asChild>
          <p className="text-foreground max-w-40 truncate text-xs font-medium">
            {agentName}
          </p>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {agentName}
        </TooltipContent>
      </Tooltip>
    </div>
  );

  const coworkerCell =
    coworkerName !== null ? (
      <div className="flex min-w-0 items-center gap-2">
        <Avatar className="size-6 shrink-0">
          {coworkerImage ? (
            <AvatarImage
              src={coworkerImage}
              alt={coworkerName}
              className="object-cover"
            />
          ) : null}
          <AvatarFallback className="text-[10px] font-medium">
            {coworkerName.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="text-foreground max-w-40 truncate text-xs font-medium">
              {coworkerName}
            </p>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {coworkerName}
          </TooltipContent>
        </Tooltip>
      </div>
    ) : null;

  const timeCell = (
    <p className="text-muted-foreground shrink-0 text-xs capitalize sm:w-[120px] sm:text-right">
      <TimeAgo date={job.createdAt} locale={locale} />
    </p>
  );

  return (
    <Link
      href={href}
      className="hover:bg-muted/50 -mx-2 flex flex-col gap-2 rounded-lg px-4 py-3 transition-colors active:scale-[0.995] sm:grid sm:grid-cols-[minmax(0,1fr)_120px_160px_160px_120px] sm:items-center sm:gap-4"
    >
      <div className="min-w-0">
        <span className="text-foreground line-clamp-1 text-sm font-medium">
          {name}
        </span>
      </div>

      {/* Mobile: keep meta grouped so it wraps nicely */}
      <div className="text-muted-foreground/70 flex flex-wrap items-center gap-3 text-xs sm:hidden">
        {statusBadge}
        {agentCell}
        {coworkerCell}
        {timeCell}
      </div>

      {/* Desktop: fixed columns so rows align */}
      <div className="hidden text-xs sm:block">{statusBadge}</div>
      <div className="hidden sm:block">{agentCell}</div>
      <div className="hidden sm:block">{coworkerCell}</div>
      <div className="hidden sm:block">{timeCell}</div>
    </Link>
  );
}
