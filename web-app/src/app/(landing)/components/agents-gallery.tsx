import { Suspense } from "react";

import { AgentCard, AgentCardSkeleton } from "@/components/agents";
import HorizontalScroll from "@/landing/components/horizontal-scroll";
import { getAgents } from "@/lib/db/services/agent.service";
import { calculateAgentCreditCost } from "@/lib/db/services/credit.service";
import { convertBaseUnitsToCredits } from "@/lib/db/utils/credit.utils";

async function AgentsList() {
  const agents = await getAgents();

  return (
    <HorizontalScroll>
      {agents.map(async (agent) => {
        const agentCreditCost = await calculateAgentCreditCost(agent);
        return (
          <AgentCard
            key={agent.id}
            agent={agent}
            agentPrice={convertBaseUnitsToCredits(agentCreditCost.credits)}
          />
        );
      })}
    </HorizontalScroll>
  );
}

function AgentsGallerySkeleton() {
  return (
    <HorizontalScroll>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
        <AgentCardSkeleton key={i} className="h-[32rem] w-[24rem]" />
      ))}
    </HorizontalScroll>
  );
}

export default function AgentsGallery() {
  return (
    <Suspense fallback={<AgentsGallerySkeleton />}>
      <AgentsList />
    </Suspense>
  );
}
