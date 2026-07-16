"use client";

import { NotificationKind, TaskStatus } from "@sokosumi/utils";
import Link from "next/link";
import { ConversationStatusBadge } from "@/app/history/components/conversation-status-badge";
import {
  HistoryMetaTime,
  HistoryOwnerAvatar,
} from "@/app/history/components/history-meta";
import { HistoryTypeIcon } from "@/app/history/components/history-type-icon";
import {
  getHistoryRowSubtitle,
  type HistoryBucketLookups,
} from "@/app/history/utils/history-row-subtitle";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import type { HistoryItem } from "@/lib/services/history.service";
import type { SokosumiJobStatus } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";
import { formatCreditsForDisplay } from "@/lib/utils/credits";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";
import { getNotificationHref } from "@/lib/utils/notification-href";

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
  activeOrganizationId: string | null;
}

export function HistoryListItem({
  item,
  bucketLookups,
  labels,
  activeOrganizationId,
}: HistoryListItemProps) {
  const { formatTimeAgo } = useLocalizedDateTime();
  const description = getHistoryRowSubtitle(item, bucketLookups, labels);
  const credits = formatHistoryCredits(item.credits, labels);
  const showOwner = activeOrganizationId !== null;
  const rowClassName = cn(
    "group -mx-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg px-4 py-3 transition-colors",
    showOwner
      ? "sm:grid-cols-[100px_minmax(0,1fr)_32px_110px_110px_80px] sm:items-center sm:gap-4"
      : "sm:grid-cols-[100px_minmax(0,1fr)_110px_110px_80px] sm:items-center sm:gap-4",
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
      activeOrganizationId={activeOrganizationId}
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
  activeOrganizationId,
}: {
  credits: string;
  description: string;
  formatTimeAgo: (date: string | Date) => string;
  item: HistoryItem;
  labels: HistoryListItemLabels;
  bucketLookups: HistoryBucketLookups;
  activeOrganizationId: string | null;
}) {
  const showOwner = activeOrganizationId !== null;
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
        {showOwner && (
          <div className="flex items-center sm:col-start-3 sm:row-start-1">
            <HistoryOwnerAvatar owner={item.owner} />
          </div>
        )}
        <div
          className={cn(
            "flex items-center",
            showOwner
              ? "sm:col-start-4 sm:row-start-1"
              : "sm:col-start-3 sm:row-start-1",
          )}
        >
          <HistoryStatus item={item} labels={labels} />
        </div>
        <HistoryMetaTime
          updatedAt={item.updatedAt}
          formatTimeAgo={formatTimeAgo}
          updatedLabel={labels.updated}
          className={cn(
            showOwner
              ? "sm:col-start-5 sm:row-start-1"
              : "sm:col-start-4 sm:row-start-1",
          )}
        />
        <span
          className={cn(
            "text-muted-foreground tabular-nums sm:text-right",
            showOwner
              ? "sm:col-start-6 sm:row-start-1"
              : "sm:col-start-5 sm:row-start-1",
          )}
        >
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
  return getNotificationHref({
    kind: item.kind.toUpperCase() as NotificationKind,
    referenceId: item.id,
    metadata:
      item.kind === "job"
        ? { agentId: item.agentId }
        : item.kind === "conversation"
          ? { bucketSlug: item.bucketSlug }
          : null,
  });
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
