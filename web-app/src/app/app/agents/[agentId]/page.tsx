import { notFound } from "next/navigation";

import { AgentDetail } from "@/components/agents";
import {
  CreateJobModal,
  CreateJobModalContextProvider,
} from "@/components/create-job-modal";
import { getAgentById } from "@/lib/db/agent/repo";
import { getJobsByAgentId } from "@/lib/db/job/repo";
import { getOrCreateFavoriteAgentList } from "@/lib/services/agentList/service";
import { getAgentCreditsPrice } from "@/lib/services/credit/service";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;

  const agent = await getAgentById(agentId);
  if (!agent) {
    return notFound();
  }

  const agentCreditsPrice = await getAgentCreditsPrice(agent);
  if (!agentCreditsPrice) {
    return notFound();
  }

  const agentList = await getOrCreateFavoriteAgentList();
  const jobs = await getJobsByAgentId(agentId);

  return (
    <CreateJobModalContextProvider
      agentsWithPrice={[{ agent, creditsPrice: agentCreditsPrice }]}
    >
      <div className="mx-auto flex justify-center px-4 py-8">
        <AgentDetail
          agent={agent}
          agentCreditsPrice={agentCreditsPrice}
          agentList={agentList}
          jobs={jobs}
        />
      </div>
      {/* Create Job Modal */}
      <CreateJobModal />
    </CreateJobModalContextProvider>
  );
}
