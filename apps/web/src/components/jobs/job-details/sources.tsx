"use client";
import { JobWithStatus } from "@sokosumi/database";
import { useTranslations } from "next-intl";

import DefaultErrorBoundary from "@/components/default-error-boundary";
import { getOutputBlobs, getResultLinks } from "@/lib/utils/job-transformers";

import { SourcesGrid } from "./sources-grid";

interface JobOutputSourcesProps {
  job: JobWithStatus;
}
export default function JotOutputSources({ job }: JobOutputSourcesProps) {
  return (
    <DefaultErrorBoundary fallback={<div />}>
      <JobOutputSourcesInner job={job} />
    </DefaultErrorBoundary>
  );
}
function JobOutputSourcesInner({ job }: JobOutputSourcesProps) {
  const t = useTranslations("Components.Jobs.JobDetails.Sources");

  const outputBlobs = getOutputBlobs(job);
  const links = getResultLinks(job);
  if (outputBlobs.length === 0 && links.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {outputBlobs.length > 0 ? (
        <SourcesGrid title={t("files")} blobs={outputBlobs} />
      ) : null}
      {links.length > 0 ? (
        <SourcesGrid title={t("links")} links={links} />
      ) : null}
    </div>
  );
}
