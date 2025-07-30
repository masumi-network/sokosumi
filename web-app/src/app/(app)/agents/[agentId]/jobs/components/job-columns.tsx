"use client";

import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useFormatter, useTranslations } from "next-intl";

import { DataTableColumnHeader } from "@/components/data-table";
import { MiddleTruncate } from "@/components/middle-truncate";
import useAgentJobStatus from "@/hooks/use-agent-job-status";
import { JobStatus, JobWithStatus } from "@/lib/db";

import JobStatusBadge from "./job-status-badge";

const columnHelper = createColumnHelper<JobWithStatus>();

export function getJobColumns(
  userId: string,
  t: ReturnType<typeof useTranslations>,
  dateFormatter: ReturnType<typeof useFormatter>,
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
          <RealTimeJobStatusBadge
            agentId={row.original.agentId}
            userId={userId}
            jobId={row.original.id}
            initialStatus={row.original.status}
          />
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
        <div className="p-2">
          {!!row.original.name ? (
            <p className="max-w-40 truncate">{row.original.name}</p>
          ) : (
            <MiddleTruncate
              text={row.original.name ?? row.original.id}
              className="font-mono text-xs"
            />
          )}
        </div>
      ),
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<JobWithStatus>,
  };
}

function RealTimeJobStatusBadge({
  agentId,
  userId,
  jobId,
  initialStatus,
  className,
}: {
  agentId: string;
  userId: string;
  jobId: string;
  initialStatus: JobStatus;
  className?: string;
}) {
  const realTimeJobStatus = useAgentJobStatus(
    agentId,
    userId,
    jobId,
    initialStatus,
    true,
  );

  return (
    <JobStatusBadge
      status={realTimeJobStatus ?? initialStatus}
      className={className}
    />
  );
}
