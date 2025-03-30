"use client";

import { useFormatter, useTranslations } from "next-intl";

import { getSharedJobColumns } from "@/app/jobs/components/job-columns";
import { DataTable } from "@/components/data-table";
import { JobWithRelations } from "@/lib/db/services/job.service";
import { cn } from "@/lib/utils";

interface JobsTableProps {
  jobs: JobWithRelations[];
}

export default function JobsTable({ jobs }: JobsTableProps) {
  const t = useTranslations("App.Jobs.JobsTable");
  const dateFormatter = useFormatter();

  return (
    <DataTable
      columns={getColumns(t, dateFormatter)}
      data={jobs}
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
  const { startedAtColumn, statusColumn, idColumn } = getSharedJobColumns(
    t,
    dateFormatter,
  );

  return [startedAtColumn, statusColumn, idColumn];
}
