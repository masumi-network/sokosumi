"use client";

import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useFormatter, useTranslations } from "next-intl";
import React from "react";

import JobStatusBadge from "@/app/jobs/components/job-status-badge";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { JobWithRelations } from "@/lib/db/services/job.service";

interface JobsTableProps {
  jobs: JobWithRelations[];
}

export default function JobsTable({ jobs }: JobsTableProps) {
  const t = useTranslations("App.Jobs.JobTable");
  const dateFormatter = useFormatter();

  const columns = getColumns(t, dateFormatter);

  // Define default sorting - newest jobs first
  const defaultSort = [
    {
      id: "startedAt",
      desc: true,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={jobs}
      containerClassName="w-full rounded-md border"
      showPagination
      defaultSort={defaultSort}
    />
  );
}

// Table columns definition
function getColumns(
  t: ReturnType<typeof useTranslations>,
  dateFormatter: ReturnType<typeof useFormatter>,
): Array<ColumnDef<JobWithRelations, unknown>> {
  const columnHelper = createColumnHelper<JobWithRelations>();

  return [
    columnHelper.accessor("startedAt", {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.started")} />
      ),
      cell: ({ row }) => (
        <div className="p-2">
          {dateFormatter.dateTime(new Date(row.original.startedAt), {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </div>
      ),
      sortingFn: "datetime",
      enableHiding: false,
    }) as ColumnDef<JobWithRelations>,

    columnHelper.accessor("status", {
      id: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.status")} />
      ),
      cell: ({ row }) => (
        <div className="p-2">
          <JobStatusBadge status={row.original.status} />
        </div>
      ),
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<JobWithRelations>,

    columnHelper.accessor((row) => row.agent.name, {
      id: "agentName",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.agent")} />
      ),
      cell: ({ row }) => <div className="p-2">{row.original.agent.name}</div>,
      enableHiding: false,
    }) as ColumnDef<JobWithRelations>,

    columnHelper.accessor("id", {
      id: "jobId",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.id")} />
      ),
      cell: ({ row }) => (
        <div className="p-2">
          <div className="font-mono text-xs">{row.original.id}</div>
        </div>
      ),
      enableSorting: true,
      enableHiding: false,
    }) as ColumnDef<JobWithRelations>,
  ];
}
