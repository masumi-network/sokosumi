"use client";

import { AgentHireButton } from "@/components/agents";
import { AgentPriceBottomNavigation } from "@/components/agents/agent-price-bottom-navigation";
import type { CoreAgentDto } from "@/lib/types/core-dto";

interface AgentBottomNavigationProps {
  agent: CoreAgentDto;
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
