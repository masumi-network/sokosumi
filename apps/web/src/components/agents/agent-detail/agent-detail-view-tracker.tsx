"use client";

import { AgentWithCreditsPrice } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";
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
