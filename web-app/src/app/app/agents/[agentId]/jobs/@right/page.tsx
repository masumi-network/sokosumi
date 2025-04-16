import { notFound } from "next/navigation";

import { getAgentById } from "@/lib/db/services/agent.service";
import { getAgentCreditsPrice } from "@/lib/db/services/credit.service";

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

  const agentCreditsPrice = await getAgentCreditsPrice(agent);

  return (
    <CreateJobSection agent={agent} agentCreditsPrice={agentCreditsPrice} />
  );
}
