"use client";

import { ChannelProvider } from "ably/react";
import { useParams, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { useState } from "react";

import { DataTable } from "@/components/data-table";
import DynamicAblyProvider from "@/contexts/alby-provider.dynamic";
import { useAsyncRouter } from "@/hooks/use-async-router";
import { makeAgentJobsChannel } from "@/lib/ably";
import { JobWithStatus } from "@/lib/db";
import { cn } from "@/lib/utils";

import { getJobColumns } from "./job-columns";
import { JobsSearch } from "./jobs-search";

interface JobsTableProps {
  jobs: JobWithStatus[];
  userId: string;
}

export default function JobsTable({ jobs, userId }: JobsTableProps) {
  const t = useTranslations("Components.Jobs.JobsTable");
  const dateFormatter = useFormatter();
  const params = useParams<{ agentId: string; jobId?: string | undefined }>();
  const searchParams = useSearchParams();

  const asyncRouter = useAsyncRouter();
  const [routerLoading, setRouterLoading] = useState(false);

  // Managed by JobsSearch
  const [filteredJobs, setFilteredJobs] = useState<JobWithStatus[]>(jobs);
  const [queryParam] = useQueryState("query", { defaultValue: "" });

  const handleRowClick = async (row: JobWithStatus) => {
    setRouterLoading(true);
    const qs = searchParams?.toString();
    const base = `/agents/${row.agentId}/jobs/${row.id}`;
    const href = qs ? `${base}?${qs}` : base;
    await asyncRouter.push(href);
    setRouterLoading(false);
  };

  return (
    <DynamicAblyProvider>
      <ChannelProvider
        channelName={makeAgentJobsChannel(params.agentId, userId)}
      >
        <div className="job-table-width bg-muted/50 flex flex-col rounded-xl">
          <JobsSearch
            jobs={jobs}
            onFilteredChange={(list) => setFilteredJobs(list)}
          />
          <DataTable
            tableClassName="[&>div>div>div]:flex! [&>div>div>div]:md:table!"
            columns={getColumns(userId, t, dateFormatter, queryParam)}
            onRowClick={(row) => async () => {
              if (routerLoading) return;
              await handleRowClick(row as JobWithStatus);
            }}
            data={filteredJobs}
            rowClassName={(row) => {
              return cn({
                "text-primary-foreground bg-primary hover:bg-primary active:bg-primary":
                  params.jobId === row.id,
                "text-foreground active:bg-muted hover:bg-muted":
                  params.jobId !== row.id,
              });
            }}
            containerClassName={cn("min-h-[300px] bg-transparent")}
            defaultSort={[
              {
                id: "startedAt",
                desc: true,
              },
            ]}
          />
        </div>
      </ChannelProvider>
    </DynamicAblyProvider>
  );
}

function getColumns(
  userId: string,
  t: ReturnType<typeof useTranslations>,
  dateFormatter: ReturnType<typeof useFormatter>,
  highlightQuery?: string,
) {
  const { startedAtColumn, statusColumn, nameColumn } = getJobColumns(
    userId,
    t,
    dateFormatter,
    highlightQuery,
  );

  return [startedAtColumn, statusColumn, nameColumn];
}
