"use client";

import { useParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { DataTable } from "@/components/data-table";
import { useAsyncRouterPush } from "@/hooks/use-async-router";
import { JobWithStatus } from "@/lib/db";
import { cn } from "@/lib/utils";

import { getJobColumns } from "./job-columns";

interface JobsTableProps {
  jobs: JobWithStatus[];
}

export default function JobsTable({ jobs }: JobsTableProps) {
  const t = useTranslations("App.Agents.Jobs.JobsTable");
  const dateFormatter = useFormatter();
  const params = useParams<{ jobId?: string | undefined }>();

  const asyncRouter = useAsyncRouterPush();
  const [routerLoading, setRouterLoading] = useState(false);

  const handleRowClick = async (row: JobWithStatus) => {
    setRouterLoading(true);
    await asyncRouter.push(`/app/agents/${row.agentId}/jobs/${row.id}`);
    setRouterLoading(false);
  };

  return (
    <DataTable
      columns={getColumns(t, dateFormatter)}
      onRowClick={(row) => async () => {
        if (routerLoading) return;
        await handleRowClick(row as JobWithStatus);
      }}
      data={jobs}
      rowClassName={(row) => {
        return cn({
          "text-primary-foreground bg-primary hover:bg-primary active:bg-primary":
            params.jobId === row.id,
          "text-foreground active:bg-muted hover:bg-muted":
            params.jobId !== row.id,
        });
      }}
      containerClassName={cn(
        "job-table-width min-h-[300px] rounded-xl bg-muted/50",
      )}
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
