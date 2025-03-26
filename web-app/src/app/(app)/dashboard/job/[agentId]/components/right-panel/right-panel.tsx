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

  if (isCreating) return <CreatingSection />;

  if (jobId) return <JobDetailSection jobId={jobId} />;

  return null;
}
