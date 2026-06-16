"use client";

import { AgentPriceBottomNavigation } from "@/components/agents/agent-price-bottom-navigation";
import { CreateJobModalTrigger } from "@/components/create-job-modal";
import type { CoreAgentDto } from "@/lib/types/core-dto";

interface JobBottomNavigationProps {
  agent: CoreAgentDto;
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
