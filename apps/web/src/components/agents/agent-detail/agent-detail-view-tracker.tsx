"use client";

import { useEffect } from "react";
import { fireGTMEvent } from "@/lib/gtm-events";
import { getAgentName } from "@/lib/helpers/agent";
import type { CoreAgentDto } from "@/lib/types/core-dto";
import { getAgentCredits } from "@/lib/types/core-dto";

interface AgentDetailViewTrackerProps {
  agent: CoreAgentDto;
}

export function AgentDetailViewTracker({ agent }: AgentDetailViewTrackerProps) {
  useEffect(() => {
    fireGTMEvent.viewAgent(getAgentName(agent), getAgentCredits(agent));
  }, [agent]);

  return null;
}
