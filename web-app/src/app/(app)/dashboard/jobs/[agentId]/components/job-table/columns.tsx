"use client";

import { ColumnDef, createColumnHelper } from "@tanstack/react-table";

import { DataTableColumnHeader } from "@/components/data-table";

import JobStatusBadge from "./job-status-badge";
import { Job } from "./schema";

const columnHelper = createColumnHelper<Job>();

export const columns: (
  t: IntlTranslation<"App.Job.JobTable">,
  dateFormatter: IntlDateFormatter,
) => ColumnDef<Job>[] = (t, dateFormatter) => [
  columnHelper.accessor("startedTime", {
    minSize: 120,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title={t("Header.started")} />
    ),
    cell: ({ row }) => (
      <div className="p-2">
        {dateFormatter.dateTime(new Date(row.original.startedTime), {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}
      </div>
    ),
    sortingFn: (rowA, rowB) => {
      const a = rowA.original.startedTime;
      const b = rowB.original.startedTime;
      return new Date(a).getTime() - new Date(b).getTime();
    },
    enableHiding: false,
  }) as ColumnDef<Job>,

  columnHelper.display({
    id: "job",
    minSize: 240,
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
  }),
];
