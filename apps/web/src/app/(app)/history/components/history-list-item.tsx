"use client";

import { SokosumiJobStatus, TaskStatus } from "@sokosumi/database";
import { ListTodo } from "lucide-react";
import Link from "next/link";
import {
  getHistoryRowSubtitle,
  type HistorySubtitleLookups,
} from "@/app/history/utils/history-row-subtitle";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { AgentIcon } from "@/components/agents/agent-icon";
import { ChatModelIcon } from "@/components/chat/chat-model-icon";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import type { HistoryItem } from "@/lib/services/history.service";
import { cn } from "@/lib/utils";
import { formatCreditsForDisplay } from "@/lib/utils/credits";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";

export interface HistoryListItemLabels {
  credit: string;
  credits: string;
  creditsUnavailable: string;
  noDescription: string;
  updated: string;
  kind: {
    task: string;
    job: string;
    conversation: string;
  };
  conversationStatus: {
    active: string;
    archived: string;
  };
}

interface HistoryListItemProps {
  item: HistoryItem;
  subtitleLookups: HistorySubtitleLookups;
  labels: HistoryListItemLabels;
}

export function HistoryListItem({
  item,
  subtitleLookups,
  labels,
}: HistoryListItemProps) {
  const { formatTimeAgo } = useLocalizedDateTime();
  const description = getHistoryRowSubtitle(item, subtitleLookups, labels);
  const credits = formatHistoryCredits(item.credits, labels);

  return (
    <Link
      href={getHistoryItemHref(item)}
      className={cn(
        "group -mx-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg px-4 py-3 transition-colors",
        "hover:bg-muted/50 active:scale-[0.995]",
        "sm:grid-cols-[100px_minmax(0,1fr)_110px_110px_80px] sm:items-center sm:gap-4",
      )}
    >
      <HistoryTypeColumn
        item={item}
        labels={labels}
        subtitleLookups={subtitleLookups}
      />

      <div className="min-w-0">
        <span className="text-foreground line-clamp-1 text-sm font-medium">
          {item.title}
        </span>
        <p className="text-muted-foreground/70 mt-1 line-clamp-1 text-xs break-all">
          {description}
        </p>
      </div>

      <div className="text-muted-foreground/70 col-span-2 flex flex-wrap items-center gap-3 text-xs sm:contents justify-between sm:justify-start">
        <div className="flex items-center sm:col-start-3 sm:row-start-1">
          <HistoryStatus item={item} labels={labels} />
        </div>
        <HistoryMetaTime
          updatedAt={item.updatedAt}
          formatTimeAgo={formatTimeAgo}
          updatedLabel={labels.updated}
          className="sm:col-start-4 sm:row-start-1"
        />
        <span className="text-muted-foreground tabular-nums sm:col-start-5 sm:row-start-1 sm:text-right">
          {credits}
        </span>
      </div>
    </Link>
  );
}

export function getHistoryItemHref(item: HistoryItem): string {
  switch (item.kind) {
    case "task":
      return `/tasks/${encodeURIComponent(item.id)}`;
    case "job":
      return `/agents/${encodeURIComponent(item.agentId)}/jobs/${encodeURIComponent(item.id)}`;
    case "conversation":
      return item.bucketSlug
        ? `/chat/${encodeURIComponent(item.bucketSlug)}/conversation/${encodeURIComponent(item.id)}`
        : "/chat";
  }
}

function HistoryTypeColumn({
  item,
  labels,
  subtitleLookups,
}: {
  item: HistoryItem;
  labels: HistoryListItemLabels;
  subtitleLookups: HistorySubtitleLookups;
}) {
  const jobAgentName =
    item.kind === "job" && item.agentId
      ? subtitleLookups.agentNameById[item.agentId]
      : undefined;

  return (
    <div className="flex w-9 shrink-0 items-center gap-1.5 sm:w-30">
      <span
        className="text-muted-foreground flex size-9 items-center justify-center rounded-full"
        aria-hidden
      >
        {item.kind === "task" ? (
          <ListTodo className="size-4" />
        ) : item.kind === "job" ? (
          <AgentIcon
            agent={{ name: jobAgentName ?? item.title, icon: null }}
            className="size-4"
          />
        ) : (
          <ChatModelIcon
            modelId=""
            modelName={labels.kind.conversation}
            className="size-4"
            size={16}
          />
        )}
      </span>
      <span className="text-muted-foreground w-full rounded-full px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase hidden sm:block">
        {labels.kind[item.kind]}
      </span>
    </div>
  );
}

function HistoryMetaTime({
  updatedAt,
  formatTimeAgo,
  updatedLabel,
  className,
}: {
  updatedAt: string | Date;
  formatTimeAgo: (date: string | Date) => string;
  updatedLabel: string;
  className?: string;
}) {
  const dateTime =
    updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt;

  return (
    <time
      dateTime={dateTime}
      className={cn(
        "text-muted-foreground whitespace-nowrap text-xs capitalize sm:text-right",
        className,
      )}
      title={updatedLabel}
    >
      {formatTimeAgo(updatedAt)}
    </time>
  );
}

function HistoryStatus({
  item,
  labels,
}: {
  item: HistoryItem;
  labels: HistoryListItemLabels;
}) {
  if (item.kind === "task") {
    return <TaskStatusBadge status={item.status as TaskStatus} />;
  }

  if (item.kind === "job") {
    return <JobStatusBadge status={item.status as SokosumiJobStatus} />;
  }

  return (
    <div className="inline-flex shrink-0 items-center gap-1.5">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          item.status === "active"
            ? "bg-semantic-success"
            : "bg-muted-foreground",
        )}
        aria-hidden
      />
      <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
        {labels.conversationStatus[item.status]}
      </span>
    </div>
  );
}

function formatHistoryCredits(
  credits: number | null,
  labels: Pick<
    HistoryListItemLabels,
    "credit" | "credits" | "creditsUnavailable"
  >,
): string {
  if (credits === null) return labels.creditsUnavailable;

  const formattedCredits = formatCreditsForDisplay(credits);
  const unit = formattedCredits === 1 ? labels.credit : labels.credits;

  return `${formattedCredits} ${unit}`;
}
