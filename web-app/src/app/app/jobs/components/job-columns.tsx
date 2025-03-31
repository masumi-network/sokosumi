import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useFormatter, useTranslations } from "next-intl";

import JobStatusBadge from "@/app/jobs/components/job-status-badge";
import { DataTableColumnHeader } from "@/components/data-table";
import { JobWithRelations } from "@/lib/db/services/job.service";

const columnHelper = createColumnHelper<JobWithRelations>();

/**
 * Returns common job table columns shared across job tables
 */
export function getSharedJobColumns(
  t: ReturnType<typeof useTranslations>,
  dateFormatter: ReturnType<typeof useFormatter>,
) {
  return {
    startedAtColumn: columnHelper.accessor("startedAt", {
      id: "startedAt",
      minSize: 80,
      maxSize: 100,
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

    statusColumn: columnHelper.accessor("status", {
      id: "status",
      minSize: 100,
      maxSize: 120,
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

    idColumn: columnHelper.accessor("id", {
      id: "id",
      minSize: 200,
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
  };
}
