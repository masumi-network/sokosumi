"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

import CreatingSection from "./creating-section";
import JobDetailSection from "./job-detail-section";

export default function RightPanel() {
  const searchParams = useSearchParams();
  const [isCreating, jobId] = useMemo(
    () => [searchParams.get("creating") === "true", searchParams.get("jobId")],
    [searchParams],
  );

  if (isCreating)
    return (
      <div className="flex h-full w-full flex-1 flex-col">
        <CreatingSection />
      </div>
    );

  if (jobId)
    return (
      <div className="flex h-full w-full flex-1 flex-col">
        <JobDetailSection jobId={jobId} />
      </div>
    );

  return null;
}
