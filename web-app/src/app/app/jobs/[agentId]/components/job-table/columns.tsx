"use client";

import { ColumnDef, createColumnHelper } from "@tanstack/react-table";

import { DataTableColumnHeader } from "@/components/data-table";
import { JobWithRelations } from "@/lib/db/services/job.service";

import JobStatusBadge from "./job-status-badge";

const columnHelper = createColumnHelper<JobWithRelations>();

export const columns: (
  t: IntlTranslation<"App.Jobs.JobTable">,
  dateFormatter: IntlDateFormatter,
) => ColumnDef<JobWithRelations>[] = (t, dateFormatter) => [
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
