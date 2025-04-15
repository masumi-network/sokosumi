import Link from "next/link";

import { AgentCard } from "@/components/agents";
import { Button } from "@/components/ui/button";
import { getAgents } from "@/lib/db/services/agent.service";
import { calculateAgentCreditCost } from "@/lib/db/services/credit.service";
import { convertBaseUnitsToCredits } from "@/lib/db/utils/credit.utils";

export default async function FeaturedAgents() {
  const agents = await getAgents();
  const firstFourAgents = agents.slice(0, 4);

  const agentPriceList = await Promise.all(
    firstFourAgents.map(async (agent) => {
      const creditCost = await calculateAgentCreditCost(agent);
      return convertBaseUnitsToCredits(creditCost.credits);
    }),
  );

  return (
    <div className="flex w-full flex-col gap-16">
      <div className="flex items-center justify-between">
        <h2 className="text-4xl font-light">{"Featured Agents"}</h2>
        <Button variant="muted" className="text-sm">
          <Link href="/agents">{"Explore all"}</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {firstFourAgents.map((agent, index) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            agentPrice={agentPriceList[index]}
          />
        ))}
      </div>
    </div>
  );
}
