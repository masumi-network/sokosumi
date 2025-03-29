"use client";

import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useFormatter, useTranslations } from "next-intl";

import JobStatusBadge from "@/app/jobs/job-status-badge";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { JobWithRelations } from "@/lib/db/services/job.service";
import { cn } from "@/lib/utils";

interface JobTableProps {
  jobs: JobWithRelations[];
}

export default function JobTable({ jobs }: JobTableProps) {
  const t = useTranslations("App.Jobs.JobTable");
  const dateFormatter = useFormatter();

  return (
    <DataTable
      columns={getColumns(t, dateFormatter)}
      data={jobs}
      containerClassName={cn("w-full lg:w-[max(400px,36%)] rounded-md border")}
    />
  );
}

const columnHelper = createColumnHelper<JobWithRelations>();

function getColumns(
  t: ReturnType<typeof useTranslations>,
  dateFormatter: ReturnType<typeof useFormatter>,
) {
  return [
    columnHelper.accessor("startedAt", {
      minSize: 120,
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
      sortingFn: (rowA, rowB) => {
        const a = rowA.original.startedAt;
        const b = rowB.original.startedAt;
        return new Date(a).getTime() - new Date(b).getTime();
      },
      enableHiding: false,
    }) as ColumnDef<JobWithRelations>,

    columnHelper.accessor("status", {
      minSize: 100,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.status")} />
      ),
      cell: ({ row }) => (
        <div className="p-2">
          <JobStatusBadge status={row.original.status} />
        </div>
      ),
      enableHiding: false,
    }) as ColumnDef<JobWithRelations>,

    columnHelper.display({
      id: "job",
      minSize: 240,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.job")} />
      ),
      cell: ({ row }) => (
        <div className="flex items-center p-2">
          <div className="w-full truncate">{row.original.input}</div>
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    }),
  ];
}
