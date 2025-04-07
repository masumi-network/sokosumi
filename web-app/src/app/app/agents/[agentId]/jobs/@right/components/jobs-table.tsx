"use client";

import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";

import { DataTable } from "@/components/data-table";
import { JobWithRelations } from "@/lib/db/services/job.service";
import { cn } from "@/lib/utils";

import { getJobColumns } from "./job-columns";

interface JobsTableProps {
  jobs: JobWithRelations[];
  highlightedJobIds: string[] | undefined;
}

export default function JobsTable({ jobs, highlightedJobIds }: JobsTableProps) {
  const t = useTranslations("App.Agents.Jobs.JobsTable");
  const dateFormatter = useFormatter();
  const router = useRouter();

  return (
    <DataTable
      columns={getColumns(t, dateFormatter)}
      rowOnClick={(row) => () => {
        router.push(`/app/agents/${row.agentId}/jobs/${row.id}`);
        router.refresh();
      }}
      data={jobs}
      rowClassName={(row) => {
        if (highlightedJobIds?.includes(row.id))
          return "bg-gray-200 hover:bg-gray-200";
        return "active:bg-gray-100 hover:bg-gray-50";
      }}
      containerClassName={cn("w-full lg:w-[max(400px,36%)] rounded-md border")}
      defaultSort={[
        {
          id: "startedAt",
          desc: true,
        },
      ]}
    />
  );
}

function getColumns(
  t: ReturnType<typeof useTranslations>,
  dateFormatter: ReturnType<typeof useFormatter>,
) {
  const { startedAtColumn, statusColumn, idColumn } = getJobColumns(
    t,
    dateFormatter,
  );

  return [startedAtColumn, statusColumn, idColumn];
}
