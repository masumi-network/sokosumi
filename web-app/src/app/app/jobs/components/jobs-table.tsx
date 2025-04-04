"use client";

import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { usePathname, useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import React from "react";

import { getSharedJobColumns } from "@/app/jobs/components/job-columns";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { JobWithRelations } from "@/lib/db/services/job.service";

interface JobsTableProps {
  jobs: JobWithRelations[];
}

export default function JobsTable({ jobs }: JobsTableProps) {
  const t = useTranslations("App.Jobs.JobsTable");
  const dateFormatter = useFormatter();
  const router = useRouter();
  const pathname = usePathname();

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
      rowOnClick={(row) => () => {
        router.push(`${pathname}/${row.id}`);
      }}
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
  const { startedAtColumn, statusColumn, idColumn } = getSharedJobColumns(
    t,
    dateFormatter,
  );

  return [
    startedAtColumn,
    statusColumn,

    columnHelper.accessor((row) => row.agent.name, {
      id: "agentName",
      minSize: 150,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t("Header.agent")} />
      ),
      cell: ({ row }) => <div className="p-2">{row.original.agent.name}</div>,
      enableHiding: false,
    }) as ColumnDef<JobWithRelations>,

    idColumn,
  ];
}
