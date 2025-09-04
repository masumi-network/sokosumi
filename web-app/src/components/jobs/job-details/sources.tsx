"use client";
import { useTranslations } from "next-intl";

import DefaultErrorBoundary from "@/components/default-error-boundary";
import { JobWithStatus } from "@/lib/db";

import { SourcesGrid } from "./sources-grid";

interface SourcesProps {
  job: JobWithStatus;
}
export default function Sources({ job }: SourcesProps) {
  return (
    <DefaultErrorBoundary fallback={<div />}>
      <SourcesInner job={job} />
    </DefaultErrorBoundary>
  );
}
function SourcesInner({ job }: SourcesProps) {
  const t = useTranslations("Components.Jobs.JobDetails.Sources");
  const blobs = (job.blobs ?? []).filter((blob) => {
    return (blob as unknown as { origin?: string }).origin === "OUTPUT";
  });
  const links = job.links ?? [];
  if (blobs.length === 0 && links.length === 0) return null;

  return (
    <SourcesGrid
      title={t("title")}
      files={blobs.map((blob) => ({
        id: blob.id,
        url:
          blob.fileUrl ??
          (blob as unknown as { sourceUrl?: string | null }).sourceUrl ??
          "#",
        fileName: blob.fileName ?? undefined,
        size: blob.size,
        status: (blob as unknown as { status?: string }).status ?? undefined,
      }))}
      links={links.map((link) => ({
        id: link.id,
        url: link.url,
        title: link.title ?? undefined,
      }))}
    />
  );
}
