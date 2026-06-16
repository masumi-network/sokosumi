"use client";

import type { AgentWithCreditsPrice } from "@sokosumi/utils";

import { AgentHireButton } from "@/components/agents";
import { AgentPriceBottomNavigation } from "@/components/agents/agent-price-bottom-navigation";

interface AgentBottomNavigationProps {
  agent: AgentWithCreditsPrice;
}

export default function AgentBottomNavigation({
  agent,
}: AgentBottomNavigationProps) {
  return (
    <AgentPriceBottomNavigation
      agent={agent}
      action={<AgentHireButton agentId={agent.id} />}
    />
  );
}
