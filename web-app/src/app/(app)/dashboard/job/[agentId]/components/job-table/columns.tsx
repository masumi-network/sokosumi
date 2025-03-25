"use client";

import { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";

import { DataTableColumnHeader } from "@/components/data-table";
import { Checkbox } from "@/components/ui/checkbox";

import { Job } from "./schema";

export const columns: ColumnDef<Job, string>[] = [
  {
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
  },
  {
    accessorKey: "startedTime",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Started" />
    ),
    cell: ({ row }) => (
      <div className="p-2">
        {dayjs(row.getValue("startedTime")).format("YYYY-MM-DD")}
      </div>
    ),
    sortingFn: (rowA, rowB) => {
      const a = rowA.getValue<string>("startedTime");
      const b = rowB.getValue<string>("startedTime");
      return dayjs(a).diff(dayjs(b));
    },
  },
  {
    accessorKey: "finishedTime",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Finished" />
    ),
    cell: ({ row }) => {
      const finishedTime = row.getValue<string>("finishedTime");
      if (!finishedTime) {
        return <div className="p-2">N/A</div>;
      }
      return (
        <div className="p-2">{dayjs(finishedTime).format("YYYY-MM-DD")}</div>
      );
    },
    sortingFn: (rowA, rowB) => {
      const a = rowA.getValue<string | undefined>("finishedTime");
      const b = rowB.getValue<string | undefined>("finishedTime");
      if (!a) return 0;
      if (!b) return 1;
      return dayjs(a).diff(dayjs(b));
    },
  },
];
