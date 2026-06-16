"use client";

import type { AgentWithCreditsPrice } from "@sokosumi/utils";

import { AgentPriceBottomNavigation } from "@/components/agents/agent-price-bottom-navigation";
import { CreateJobModalTrigger } from "@/components/create-job-modal";

interface JobBottomNavigationProps {
  agent: AgentWithCreditsPrice;
  disabled?: boolean;
}

export default function JobBottomNavigation({
  agent,
  disabled,
}: JobBottomNavigationProps) {
  return (
    <AgentPriceBottomNavigation
      agent={agent}
      action={
        <CreateJobModalTrigger
          agentId={agent.id}
          disabled={disabled}
          showLabel={false}
        />
      }
    />
  );
}
