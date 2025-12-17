"use client";

import { JobWithSokosumiStatus } from "@sokosumi/database";
import { ChannelProvider } from "ably/react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { useState } from "react";

import { DataTable } from "@/components/data-table";
import DynamicAblyProvider from "@/contexts/alby-provider.dynamic";
import { makeAgentJobsChannelName } from "@/lib/ably";
import { cn, getDateGroupKey } from "@/lib/utils";

import { getJobColumns } from "./job-columns";
import { JobsSearch } from "./jobs-search";

interface JobsTableProps {
  jobs: JobWithSokosumiStatus[];
  userId: string;
}

export default function JobsTable({ jobs, userId }: JobsTableProps) {
  const t = useTranslations("Components.Jobs.JobsTable");
  const dateFormatter = useFormatter();
  const params = useParams<{ agentId: string; jobId?: string | undefined }>();
  const searchParams = useSearchParams();

  const router = useRouter();
  const [routerLoading, setRouterLoading] = useState(false);

  // Managed by JobsSearch
  const [filteredJobs, setFilteredJobs] =
    useState<JobWithSokosumiStatus[]>(jobs);
  const [queryParam] = useQueryState("query", { defaultValue: "" });

  const handleRowClick = async (row: JobWithSokosumiStatus) => {
    setRouterLoading(true);
    const qs = searchParams?.toString();
    const base = `/agents/${row.agent.id}/jobs/${row.id}`;
    const href = qs ? `${base}?${qs}` : base;
    router.push(href);
    setRouterLoading(false);
  };

  const getRowClassName = (row: JobWithSokosumiStatus) =>
    cn({
      "text-primary-foreground bg-primary hover:bg-primary active:bg-primary":
        params.jobId === row.id,
      "text-foreground active:bg-muted hover:bg-muted": params.jobId !== row.id,
    });
  const getOnRowClick = (row: JobWithSokosumiStatus) => async () => {
    if (routerLoading) return;
    await handleRowClick(row);
  };

  return (
    <DynamicAblyProvider>
      <ChannelProvider
        channelName={makeAgentJobsChannelName(params.agentId, userId)}
      >
        <div className="job-table-width bg-muted/50 flex flex-col rounded-xl border">
          <JobsSearch
            jobs={jobs}
            onFilteredChange={(list) => setFilteredJobs(list)}
          />
          <DataTable
            tableClassName="[&>div>div>div]:flex! [&>div>div>div]:md:table!"
            columns={getColumns(userId, t, dateFormatter, queryParam)}
            onRowClick={(row) => getOnRowClick(row)}
            data={filteredJobs}
            rowClassName={(row) => getRowClassName(row)}
            containerClassName={cn("min-h-[300px] bg-transparent")}
            defaultSort={[
              {
                id: "createdAt",
                desc: true,
              },
            ]}
            getGroupKey={(row) => {
              return row.createdAt ? getDateGroupKey(row.createdAt) : null;
            }}
            renderGroupHeader={(groupKey) => {
              return <div className="px-2 py-1">{groupKey}</div>;
            }}
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
  const { createdAtColumn, statusColumn, nameColumn } = getJobColumns(
    userId,
    t,
    dateFormatter,
    highlightQuery,
  );
  return [createdAtColumn, statusColumn, nameColumn];
}
