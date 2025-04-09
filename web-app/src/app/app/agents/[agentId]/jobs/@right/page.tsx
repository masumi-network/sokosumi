import { notFound } from "next/navigation";

import {
  getAgentById,
  getAgentInputSchema,
} from "@/lib/db/services/agent.service";
import { calculateAgentHumandReadableCreditCost } from "@/lib/db/services/credit.service";

import CreateJobSection from "./components/create-job-section";

interface JobPageParams {
  agentId: string;
}

export default async function RightPage({
  params,
}: {
  params: Promise<JobPageParams>;
}) {
  const { agentId } = await params;

  const agent = await getAgentById(agentId);
  if (!agent) {
    console.warn("agent not found in right page");
    notFound();
  }

  const agentPrice = await calculateAgentHumandReadableCreditCost(agent);
  const inputSchema = await getAgentInputSchema(agentId);

  return (
    <CreateJobSection
      agent={agent}
      inputSchema={inputSchema}
      agentPricing={agentPrice}
    />
  );
}
