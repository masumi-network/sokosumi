"use client";

import { useSyncExternalStore } from "react";
import { AgentHireButton } from "@/components/agents";
import { AgentPriceBottomNavigation } from "@/components/agents/agent-price-bottom-navigation";
import { ShareButton } from "@/components/share-button";
import type { CoreAgentDto } from "@/lib/types/core-dto";

interface AgentBottomNavigationProps {
  agent: CoreAgentDto;
}

export default function AgentBottomNavigation({
  agent,
}: AgentBottomNavigationProps) {
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const url = isClient
    ? new URL(`${window.location.origin}/agents/${agent.id}`)
    : undefined;

  return (
    <AgentPriceBottomNavigation
      agent={agent}
      action={
        <div className="flex items-center gap-1.5">
          <AgentHireButton agentId={agent.id} />
          {url ? <ShareButton url={url} className="size-8 md:size-7" /> : null}
        </div>
      }
    />
  );
}
