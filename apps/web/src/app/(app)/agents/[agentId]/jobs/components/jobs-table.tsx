"use client";

import { useParams, useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { useState } from "react";
import { DataTable } from "@/components/data-table";
import type { JobSummary } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";
import { buildJobHref } from "@/lib/utils/job-href";

import { getJobTableColumns } from "./job-columns";
import { JobsSearch } from "./jobs-search";

interface JobsTableProps {
  jobs: JobSummary[];
  userId: string;
}

export default function JobsTable({ jobs, userId }: JobsTableProps) {
  const t = useTranslations("Components.Jobs.JobsTable");
  const dateFormatter = useFormatter();
  const { getDateGroupKey } = useLocalizedDateTime();
  const params = useParams<{ agentId: string; jobId?: string | undefined }>();

  const router = useRouter();
  const [routerLoading, setRouterLoading] = useState(false);

  // Managed by JobsSearch
  const [filteredJobs, setFilteredJobs] = useState<JobSummary[]>(jobs);
  const [queryParam] = useQueryState("query", { defaultValue: "" });

  const handleRowClick = async (row: JobSummary) => {
    setRouterLoading(true);
    const qs = new URLSearchParams(window.location.search).toString();
    const base = buildJobHref(row.id);
    const href = qs ? `${base}?${qs}` : base;
    router.push(href);
    setRouterLoading(false);
  };

  const getRowClassName = (row: JobSummary) =>
    cn({
      "text-primary-foreground bg-primary hover:bg-primary active:bg-primary":
        params.jobId === row.id,
      "text-foreground active:bg-muted hover:bg-muted": params.jobId !== row.id,
    });
  const getOnRowClick = (row: JobSummary) => async () => {
    if (routerLoading) return;
    await handleRowClick(row);
  };

  return (
    <div className="job-table-width bg-muted/50 flex flex-col rounded-xl border">
      <JobsSearch
        jobs={jobs}
        onFilteredChange={(list) => setFilteredJobs(list)}
      />
      <DataTable
        tableClassName="[&>table]:flex! [&>table]:md:table!"
        columns={getJobTableColumns(userId, t, dateFormatter, queryParam)}
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
  );
}
