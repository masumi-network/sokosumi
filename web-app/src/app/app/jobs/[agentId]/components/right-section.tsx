"use client";

import { useSearchParams } from "next/navigation";

import { AgentWithRelations } from "@/lib/db/services/agent.service";
import { JobInputsDataSchemaType } from "@/lib/job-input";

import CreateJobSection from "./create-job-section";
import JobDetailSection from "./job-detail-section";

interface RightSectionProps {
  agent: AgentWithRelations;
  inputSchema: JobInputsDataSchemaType;
}

export default function RightSection({
  agent,
  inputSchema,
}: RightSectionProps) {
  const searchParams = useSearchParams();
  const jobId = searchParams.get("jobId") ?? "";

  if (!!jobId) {
    return <JobDetailSection agent={agent} />;
  }

  return <CreateJobSection agent={agent} inputSchema={inputSchema} />;
}
