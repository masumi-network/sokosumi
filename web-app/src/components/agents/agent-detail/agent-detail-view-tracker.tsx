"use client";

import { useEffect } from "react";

import {
  AgentWithCreditsPrice,
  convertCentsToCredits,
  getAgentName,
} from "@/lib/db";
import { fireGTMEvent } from "@/lib/gtm-events";

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
