"use client";

import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import dayjs from "dayjs";

import { DataTableColumnHeader } from "@/components/data-table";
import { Checkbox } from "@/components/ui/checkbox";

import JobStatusBadge from "./job-status-badge";
import { Job } from "./schema";

const columnHelper = createColumnHelper<Job>();

export const columns: ColumnDef<Job>[] = [
  columnHelper.display({
    id: "select",
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
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Started" />
    ),
    cell: ({ row }) => (
      <div className="p-2">
        {dayjs(row.original.startedTime).format("YYYY-MM-DD")}
      </div>
    ),
    sortingFn: (rowA, rowB) => {
      const a = rowA.original.startedTime;
      const b = rowB.original.startedTime;
      return dayjs(a).diff(dayjs(b));
    },
    enableHiding: false,
  }) as ColumnDef<Job>,
  columnHelper.accessor("status", {
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => (
      <div className="p-2">
        <JobStatusBadge status={row.original.status} />
      </div>
    ),
    sortingFn: (rowA, rowB) => {
      const a = rowA.original.status;
      const b = rowB.original.status;
      return a.localeCompare(b);
    },
    enableHiding: false,
  }) as ColumnDef<Job>,
  columnHelper.display({
    id: "job",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Job" />
    ),
    cell: ({ row }) => <div className="p-2">{row.original.input}</div>,
    enableSorting: false,
    enableHiding: false,
  }),
];
