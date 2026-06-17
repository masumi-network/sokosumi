"use client";

import { SokosumiJobStatus, TaskStatus } from "@sokosumi/utils";
import Link from "next/link";
import {
  CHAT_APP_ROUTE_PREFIX,
  FALLBACK_BUCKET_SEGMENT,
} from "@/app/chat-ui/utils/chat-route-base";
import { ConversationStatusBadge } from "@/app/history/components/conversation-status-badge";
import { HistoryTypeIcon } from "@/app/history/components/history-type-icon";
import {
  getHistoryRowSubtitle,
  type HistoryBucketLookups,
} from "@/app/history/utils/history-row-subtitle";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
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
  taskStatus: Record<TaskStatus, string>;
}

interface HistoryListItemProps {
  item: HistoryItem;
  bucketLookups: HistoryBucketLookups;
  labels: HistoryListItemLabels;
}

export function HistoryListItem({
  item,
  bucketLookups,
  labels,
}: HistoryListItemProps) {
  const { formatTimeAgo } = useLocalizedDateTime();
  const description = getHistoryRowSubtitle(item, bucketLookups, labels);
  const credits = formatHistoryCredits(item.credits, labels);
  const rowClassName = cn(
    "group -mx-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg px-4 py-3 transition-colors",
    "sm:grid-cols-[100px_minmax(0,1fr)_110px_110px_80px] sm:items-center sm:gap-4",
    isArchivedHistoryItem(item)
      ? "cursor-default"
      : "hover:bg-muted/50 active:scale-[0.995]",
  );
  const content = (
    <HistoryListItemContent
      credits={credits}
      description={description}
      formatTimeAgo={formatTimeAgo}
      item={item}
      labels={labels}
      bucketLookups={bucketLookups}
    />
  );

  if (isArchivedHistoryItem(item)) {
    return <div className={rowClassName}>{content}</div>;
  }

  return (
    <Link href={getHistoryItemHref(item)} className={rowClassName}>
      {content}
    </Link>
  );
}

function HistoryListItemContent({
  credits,
  description,
  formatTimeAgo,
  item,
  labels,
  bucketLookups,
}: {
  credits: string;
  description: string;
  formatTimeAgo: (date: string | Date) => string;
  item: HistoryItem;
  labels: HistoryListItemLabels;
  bucketLookups: HistoryBucketLookups;
}) {
  return (
    <>
      <HistoryTypeColumn
        item={item}
        labels={labels}
        bucketLookups={bucketLookups}
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
    </>
  );
}

export function isArchivedHistoryItem(item: HistoryItem): boolean {
  return item.archivedAt != null;
}

export function getHistoryItemHref(item: HistoryItem): string {
  switch (item.kind) {
    case "task":
      return `/tasks/${encodeURIComponent(item.id)}`;
    case "job":
      return `/agents/${encodeURIComponent(item.agentId)}/jobs/${encodeURIComponent(item.id)}`;
    case "conversation": {
      const bucketSegment = item.bucketSlug ?? FALLBACK_BUCKET_SEGMENT;
      return `${CHAT_APP_ROUTE_PREFIX}/${encodeURIComponent(bucketSegment)}/conversation/${encodeURIComponent(item.id)}?open=1`;
    }
  }
}

function HistoryTypeColumn({
  item,
  labels,
  bucketLookups,
}: {
  item: HistoryItem;
  labels: HistoryListItemLabels;
  bucketLookups: HistoryBucketLookups;
}) {
  return (
    <div className="flex w-9 shrink-0 items-center gap-1.5 sm:w-30">
      <span
        className="text-muted-foreground flex size-9 items-center justify-center rounded-full"
        aria-hidden
      >
        <HistoryTypeIcon
          item={item}
          labels={labels}
          bucketLookups={bucketLookups}
        />
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
    const status = item.status as TaskStatus;
    return (
      <TaskStatusBadge status={status} label={labels.taskStatus[status]} />
    );
  }

  if (item.kind === "job") {
    return <JobStatusBadge status={item.status as SokosumiJobStatus} />;
  }

  return (
    <ConversationStatusBadge
      status={item.status}
      label={labels.conversationStatus[item.status]}
    />
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
