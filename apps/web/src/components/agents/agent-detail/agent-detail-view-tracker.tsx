"use client";

import { AgentWithCreditsPrice } from "@sokosumi/database";
import { useEffect } from "react";

import { fireGTMEvent } from "@/lib/gtm-events";
import { getAgentName } from "@/lib/helpers/agent";
import { convertCentsToCredits } from "@/lib/helpers/credit";

interface AgentDetailViewTrackerProps {
  agent: AgentWithCreditsPrice;
}

export function AgentDetailViewTracker({ agent }: AgentDetailViewTrackerProps) {
  useEffect(() => {
    fireGTMEvent.viewAgent(
      getAgentName(agent),
      convertCentsToCredits(agent.creditsPrice.cents),
    );
  }, [agent]);

  return null;
}
