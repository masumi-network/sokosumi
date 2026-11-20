"use client";

import { useTrackView } from "@/hooks/effects/use-track-view";
import { getAgentName } from "@/lib/helpers/agent";
import type { CoreAgentDto } from "@/lib/types/core-dto";

interface AgentDetailViewTrackerProps {
  agent: CoreAgentDto;
}

export function AgentDetailViewTracker({ agent }: AgentDetailViewTrackerProps) {
  useTrackView("view_agent", { agentName: getAgentName(agent) }, agent);

  return null;
}
