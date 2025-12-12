"use client";
import { JobStatusWithRelations } from "@sokosumi/database";
import { useTranslations } from "next-intl";

import DefaultErrorBoundary from "@/components/default-error-boundary";

import { SourcesGrid } from "./sources-grid";

interface JobOutputSourcesProps {
  status: JobStatusWithRelations;
}
export default function JotOutputSources({ status }: JobOutputSourcesProps) {
  return (
    <DefaultErrorBoundary fallback={<div />}>
      <JobOutputSourcesInner status={status} />
    </DefaultErrorBoundary>
  );
}
function JobOutputSourcesInner({ status }: JobOutputSourcesProps) {
  const t = useTranslations("Components.Jobs.JobDetails.Sources");

  const outputBlobs = status.blobs ?? [];
  const links = status.links ?? [];
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
