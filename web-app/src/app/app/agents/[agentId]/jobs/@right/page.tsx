import { notFound } from "next/navigation";

import { getAgentById } from "@/lib/db/services/agent.service";
import { calculateAgentCreditCost } from "@/lib/db/services/credit.service";
import { convertBaseUnitsToCredits } from "@/lib/db/utils/credit.utils";

import CreateJobSection from "./components/create-job-section";

interface CreateJobPageParams {
  agentId: string;
}

export default async function CreateJobPage({
  params,
}: {
  params: Promise<CreateJobPageParams>;
}) {
  const { agentId } = await params;

  const agent = await getAgentById(agentId);
  if (!agent) {
    console.warn("agent not found in right page");
    notFound();
  }

  const agentCreditCost = await calculateAgentCreditCost(agent);
  const agentPrice = convertBaseUnitsToCredits(agentCreditCost.credits);

  return <CreateJobSection agent={agent} agentPricing={agentPrice} />;
}
