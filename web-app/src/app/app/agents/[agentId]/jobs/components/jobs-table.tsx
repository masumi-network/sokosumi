"use client";

import { useParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { DataTable } from "@/components/data-table";
import { useAsyncRouterPush } from "@/hooks/use-async-router";
import { JobWithRelations } from "@/lib/db";
import { cn } from "@/lib/utils";

import { getJobColumns } from "./job-columns";

interface JobsTableProps {
  jobs: JobWithRelations[];
}

export default function JobsTable({ jobs }: JobsTableProps) {
  const t = useTranslations("App.Agents.Jobs.JobsTable");
  const dateFormatter = useFormatter();
  const params = useParams<{ jobId?: string | undefined }>();

  const asyncRouter = useAsyncRouterPush();
  const [routerLoading, setRouterLoading] = useState(false);

  const handleRowClick = async (row: JobWithRelations) => {
    setRouterLoading(true);
    await asyncRouter.push(`/app/agents/${row.agentId}/jobs/${row.id}`);
    setRouterLoading(false);
  };

  return (
    <DataTable
      columns={getColumns(t, dateFormatter)}
      onRowClick={(row) => async () => {
        if (routerLoading) return;
        await handleRowClick(row);
      }}
      data={jobs}
      rowClassName={(row) => {
        if (params.jobId === row.id) {
          return "bg-muted hover:bg-muted";
        }
        return "active:bg-muted hover:bg-muted";
      }}
      containerClassName={cn(
        "w-full lg:w-[max(480px,32%)] rounded-xl bg-muted/50",
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
