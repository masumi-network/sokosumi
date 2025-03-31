"use client";

import { useSearchParams } from "next/navigation";

import { AgentDTO } from "@/lib/db/dto/AgentDTO";

import CreateJobSection from "./create-job-section";
import JobDetailSection from "./job-detail-section";

interface RightSectionProps {
  agent: AgentDTO;
}

export default function RightSection({ agent }: RightSectionProps) {
  const searchParams = useSearchParams();
  const jobId = searchParams.get("jobId") ?? "";

  if (!!jobId) {
    return <JobDetailSection agent={agent} />;
  }

  return <CreateJobSection agent={agent} />;
}
