"use client";

import { ColumnDef, createColumnHelper } from "@tanstack/react-table";

import { DataTableColumnHeader } from "@/components/data-table";
import { Checkbox } from "@/components/ui/checkbox";

import JobStatusBadge from "./job-status-badge";
import { Job } from "./schema";

const columnHelper = createColumnHelper<Job>();

export const columns: (dateFormatter: IntlDateFormatter) => ColumnDef<Job>[] = (
  dateFormatter,
) => [
  columnHelper.display({
    id: "select",
    size: 40,
    header: ({ table }) => (
      <div className="w-8 p-2">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="w-8 p-2">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
          className="translate-y-[2px]"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  }),

  columnHelper.accessor("startedTime", {
    minSize: 120,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Started" />
    ),
    cell: ({ row }) => (
      <div className="py-2">
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
      <DataTableColumnHeader column={column} title="Job" />
    ),
    cell: ({ row }) => (
      <div className="flex items-center gap-2 py-2">
        <JobStatusBadge status={row.original.status} />
        <div className="w-full truncate">{row.original.input}</div>
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  }),
];
