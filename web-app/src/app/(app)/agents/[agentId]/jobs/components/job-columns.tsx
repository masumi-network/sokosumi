"use client";

import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useFormatter, useTranslations } from "next-intl";

import { DataTableColumnHeader } from "@/components/data-table";
import { MiddleTruncate } from "@/components/middle-truncate";
import { HighlightedText } from "@/components/ui/highlighted-text";
import useAgentJobStatus from "@/hooks/use-agent-job-status";
import { JobIndicatorStatus } from "@/lib/ably";
import { JobWithStatus } from "@/lib/db";

import JobStatusBadge from "./job-status-badge";

const columnHelper = createColumnHelper<JobWithStatus>();

export function getJobColumns(
  userId: string,
  t: ReturnType<typeof useTranslations>,
  dateFormatter: ReturnType<typeof useFormatter>,
  highlightQuery?: string,
) {
  return {
    startedAtColumn: columnHelper.accessor("startedAt", {
      id: "startedAt",
      minSize: 80,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.started")} />
      ),
      cell: ({ row }) => (
        <div className="p-2 whitespace-nowrap">
          {dateFormatter.dateTime(new Date(row.original.startedAt), {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </div>
      ),
      sortingFn: "datetime",
      enableHiding: false,
    }) as ColumnDef<JobWithStatus>,

    statusColumn: columnHelper.accessor("status", {
      id: "status",
      minSize: 160,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.status")} />
      ),
      cell: ({ row }) => (
        <div className="p-2">
          {row.original.isDemo ? (
            <JobStatusBadge
              status={row.original.status}
              isDemo={row.original.isDemo}
            />
          ) : (
            <RealTimeJobStatusBadge
              agentId={row.original.agentId}
              userId={userId}
              jobId={row.original.id}
              initialJobIndicatorStatus={{
                jobId: row.original.id,
                jobStatus: row.original.status,
                jobStatusSettled: row.original.jobStatusSettled,
              }}
              isDemo={row.original.isDemo}
            />
          )}
        </div>
      ),
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<JobWithStatus>,

    nameColumn: columnHelper.accessor("name", {
      id: "name",
      minSize: 180,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.name")} />
      ),
      cell: ({ row }) => (
        <JobNameCell
          name={row.original.name}
          id={row.original.id}
          highlightQuery={highlightQuery}
        />
      ),
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<JobWithStatus>,
  };
}

function JobNameCell({
  name,
  id,
  highlightQuery,
}: {
  name?: string | null;
  id: string;
  highlightQuery?: string;
}) {
  const text = name ?? id;

  return (
    <div className="p-2">
      {!!name ? (
        <HighlightedText
          text={name}
          query={highlightQuery}
          className="max-w-28 truncate md:max-w-40"
          truncate
        />
      ) : (
        <HighlightedMiddleTruncate
          text={text}
          highlightQuery={highlightQuery}
          className="font-mono text-xs"
        />
      )}
    </div>
  );
}

function HighlightedMiddleTruncate({
  text,
  highlightQuery,
  className,
}: {
  text: string;
  highlightQuery?: string;
  className?: string;
}) {
  const q = (highlightQuery ?? "").trim();
  const MAX_HIGHLIGHT_LENGTH = 100;

  // If no query or query is too long, use normal MiddleTruncate
  if (!q || q.length > MAX_HIGHLIGHT_LENGTH) {
    return <MiddleTruncate text={text} className={className} />;
  }

  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const index = lower.indexOf(qLower);

  // No match found, use normal MiddleTruncate
  if (index === -1) {
    return <MiddleTruncate text={text} className={className} />;
  }

  // For IDs, show highlighted portion with context
  const matchStart = Math.max(0, index - 10);
  const matchEnd = Math.min(text.length, index + q.length + 10);
  const excerpt = text.slice(matchStart, matchEnd);

  return (
    <span className={className}>
      {matchStart > 0 && "..."}
      <HighlightedText text={excerpt} query={q} />
      {matchEnd < text.length && "..."}
    </span>
  );
}

function RealTimeJobStatusBadge({
  agentId,
  userId,
  jobId,
  initialJobIndicatorStatus,
  isDemo = false,
  className,
}: {
  agentId: string;
  userId: string;
  jobId: string;
  initialJobIndicatorStatus: JobIndicatorStatus;
  isDemo?: boolean;
  className?: string;
}) {
  const realTimeJobStatus = useAgentJobStatus(
    agentId,
    userId,
    jobId,
    initialJobIndicatorStatus,
    true,
  );

  return (
    <JobStatusBadge
      status={
        realTimeJobStatus?.jobStatus ?? initialJobIndicatorStatus.jobStatus
      }
      isDemo={isDemo}
      className={className}
    />
  );
}
