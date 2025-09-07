"use client";
import { useTranslations } from "next-intl";

import DefaultErrorBoundary from "@/components/default-error-boundary";
import { JobWithStatus } from "@/lib/db";
import { BlobOrigin } from "@/prisma/generated/client";

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

  const blobs = job.blobs.filter((blob) => blob.origin === BlobOrigin.OUTPUT);
  const links = job.links;
  if (blobs.length === 0 && links.length === 0) return null;

  return <SourcesGrid title={t("title")} blobs={blobs} links={links} />;
}
