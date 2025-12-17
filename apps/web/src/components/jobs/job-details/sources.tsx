"use client";
import { JobEventWithRelations } from "@sokosumi/database";
import { useTranslations } from "next-intl";

import DefaultErrorBoundary from "@/components/default-error-boundary";

import { SourcesGrid } from "./sources-grid";

interface JobOutputSourcesProps {
  event: JobEventWithRelations;
}
export default function JotOutputSources({ event }: JobOutputSourcesProps) {
  return (
    <DefaultErrorBoundary fallback={<div />}>
      <JobOutputSourcesInner event={event} />
    </DefaultErrorBoundary>
  );
}
function JobOutputSourcesInner({ event }: JobOutputSourcesProps) {
  const t = useTranslations("Components.Jobs.JobDetails.Sources");

  const outputBlobs = event.blobs ?? [];
  const links = event.links ?? [];
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
