"use client";

import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useFormatter, useTranslations } from "next-intl";

import { DataTableColumnHeader } from "@/components/data-table";
import { MiddleTruncate } from "@/components/middle-truncate";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useAgentJobStatus from "@/hooks/use-agent-job-status";
import { JobIndicatorStatus } from "@/lib/ably";
import { JobWithStatus } from "@/lib/db";

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
      cell: ({ row }) => {
        const job = row.original;
        const isSharedJob = job.userId !== userId;
        const orgShare = job.shares?.find(
          (share) => share.recipientOrganizationId && share.creator,
        );

        return (
          <div className="flex items-center gap-2 p-2">
            <div className="flex-1">
              {!!job.name ? (
                <p className="max-w-28 truncate md:max-w-40">{job.name}</p>
              ) : (
                <MiddleTruncate
                  text={job.name ?? job.id}
                  className="font-mono text-xs"
                />
              )}
            </div>
            {isSharedJob && orgShare && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1">
                      <Avatar className="h-6 w-6">
                        <AvatarImage
                          src={orgShare.creator.image ?? undefined}
                        />
                        <AvatarFallback className="text-xs">
                          {orgShare.creator.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <Badge variant="secondary" className="text-xs">
                        {"Shared"}
                      </Badge>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {"Shared by"} {orgShare.creator.name}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        );
      },
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<JobWithStatus>,
  };
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
