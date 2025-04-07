import { notFound } from "next/navigation";

import CreateJobSection from "@/app/agents/[agentId]/jobs/@right/components/create-job-section";
import {
  getAgentById,
  getAgentInputSchema,
} from "@/lib/db/services/agent.service";
import { calculateAgentCreditCost } from "@/lib/db/services/credit.service";

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
    console.log("agent not found in right page");
    notFound();
  }

  const agentPrice = await calculateAgentCreditCost(agent);
  const inputSchema = await getAgentInputSchema(agentId);

  return (
    <CreateJobSection
      agent={agent}
      inputSchema={inputSchema}
      agentPricing={agentPrice}
    />
  );
}
