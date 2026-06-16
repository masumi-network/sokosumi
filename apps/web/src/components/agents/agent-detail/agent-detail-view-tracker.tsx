"use client";

import type { AgentWithCreditsPrice } from "@sokosumi/utils";
import { convertCentsToCredits } from "@sokosumi/utils";
import { useEffect } from "react";

import { fireGTMEvent } from "@/lib/gtm-events";
import { getAgentName } from "@/lib/helpers/agent";

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
