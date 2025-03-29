"use client";

import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useFormatter, useTranslations } from "next-intl";

import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { JobWithRelations } from "@/lib/db/services/job.service";

interface JobsTableProps {
  jobs: JobWithRelations[];
}

export default function JobsTable({ jobs }: JobsTableProps) {
  const t = useTranslations("App.Jobs.JobTable");
  const dateFormatter = useFormatter();

  const columns = getColumns(t, dateFormatter);

  return (
    <DataTable
      columns={columns}
      data={jobs}
      containerClassName="w-full rounded-md border"
      showPagination
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

    columnHelper.accessor((row) => row.agent.name, {
      id: "agentName",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.agent")} />
      ),
      cell: ({ row }) => <div className="p-2">{row.original.agent.name}</div>,
      enableHiding: false,
    }) as ColumnDef<JobWithRelations, unknown>,

    columnHelper.display({
      id: "job",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.job")} />
      ),
      cell: ({ row }) => (
        <div className="flex items-center gap-2 p-2">
          <JobStatusBadge status={row.original.status} />
          <div className="w-full truncate">{row.original.input}</div>
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    }) as ColumnDef<JobWithRelations, unknown>,
  ];
}
