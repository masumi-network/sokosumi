"use client";

import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useFormatter, useTranslations } from "next-intl";
import React from "react";

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

// Job status badge component
function JobStatusBadge({ status }: { status: string }) {
  const getStatusColor = () => {
    switch (status) {
      case "COMPLETED":
        return "bg-green-100 text-green-800";
      case "PROCESSING":
        return "bg-blue-100 text-blue-800";
      case "FAILED":
        return "bg-red-100 text-red-800";
      case "PAYMENT_PENDING":
        return "bg-yellow-100 text-yellow-800";
      case "PAYMENT_FAILED":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getStatusColor()}`}
    >
      {status}
    </span>
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
    }) as ColumnDef<JobWithRelations, unknown>,

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
    }) as ColumnDef<JobWithRelations, unknown>,

    columnHelper.accessor((row) => row.agent.name, {
      id: "agentName",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.agent")} />
      ),
      cell: ({ row }) => <div className="p-2">{row.original.agent.name}</div>,
      enableHiding: false,
    }) as ColumnDef<JobWithRelations, unknown>,

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
    }) as ColumnDef<JobWithRelations, unknown>,
  ];
}
