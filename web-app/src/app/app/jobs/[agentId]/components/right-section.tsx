"use client";

import { useSearchParams } from "next/navigation";

import { AgentWithRelations } from "@/lib/db/services/agent.service";

import CreateJobSection from "./create-job-section";
import JobDetailSection from "./job-detail-section";

interface RightSectionProps {
  agent: AgentWithRelations;
  agentPricing: number;
}

export default function RightSection({
  agent,
  agentPricing,
}: RightSectionProps) {
  const searchParams = useSearchParams();
  const jobId = searchParams.get("jobId") ?? "";

  if (!!jobId) {
    return <JobDetailSection agent={agent} />;
  }

  return <CreateJobSection agent={agent} agentPricing={agentPricing} />;
}
