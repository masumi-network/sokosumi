"use client";

import { JobType } from "@sokosumi/utils";
import { useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import type { useFormatter, useTranslations } from "next-intl";
import { useEffect } from "react";
import { DataTableColumnHeader } from "@/components/data-table";
import { JobStatusBadge } from "@/components/jobs";
import { MiddleTruncate } from "@/components/middle-truncate";
import { HighlightedText } from "@/components/ui/highlighted-text";
import useAgentJobStatusData from "@/hooks/use-agent-job-status";
import type { JobSummary } from "@/lib/clients/generated/core";
import { getJobStatusData } from "@/lib/helpers/job";
import { getJobQueryKey } from "@/queries";

const columnHelper = createColumnHelper<JobSummary>();

export function getJobColumns(
  userId: string,
  t: ReturnType<typeof useTranslations>,
  dateFormatter: ReturnType<typeof useFormatter>,
  highlightQuery?: string,
) {
  return {
    createdAtColumn: columnHelper.accessor("createdAt", {
      id: "createdAt",
      minSize: 80,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.started")} />
      ),
      cell: ({ row }) => (
        <div className="p-2 whitespace-nowrap">
          {dateFormatter.dateTime(new Date(row.original.createdAt), {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          })}
        </div>
      ),
      sortingFn: "datetime",
      enableHiding: false,
    }) as ColumnDef<JobSummary>,

    statusColumn: columnHelper.accessor("status", {
      id: "status",
      minSize: 160,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.status")} />
      ),
      cell: ({ row }) => {
        return (
          <div className="p-2">
            {row.original.jobType === JobType.DEMO ? (
              <JobStatusBadge
                key={`${row.original.id}-${row.original.status}-column-badge`}
                status={row.original.status}
                jobType={row.original.jobType}
              />
            ) : (
              <RealTimeJobStatusBadge
                key={`${row.original.id}-${row.original.status}-column-real-time-badge`}
                userId={userId}
                job={row.original}
              />
            )}
          </div>
        );
      },
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<JobSummary>,

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
    }) as ColumnDef<JobSummary>,
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
      {name ? (
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
  userId,
  job,
  className,
}: {
  userId: string;
  job: JobSummary;
  className?: string;
}) {
  const queryClient = useQueryClient();

  const jobStatusData =
    useAgentJobStatusData(job.agentId, userId, job.id) ?? getJobStatusData(job);

  useEffect(() => {
    queryClient.invalidateQueries({
      queryKey: getJobQueryKey(job.id),
    });
  }, [queryClient, jobStatusData, job.id]);

  return (
    <JobStatusBadge
      key={`${job.id}-${jobStatusData.jobStatus}-real-time-badge`}
      status={jobStatusData.jobStatus}
      jobType={job.jobType}
      className={className}
    />
  );
}
