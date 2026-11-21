"use client";

import {
  useIsAgentUnavailable,
  useMarkAgentUnavailable,
} from "@/hooks/effects/use-mark-agent-unavailable";

/**
 * Agents whose detail page would 404 (deleted or no access) while their
 * historical jobs stay open. The mobile top bar sits outside the jobs layout,
 * so the layout marks the agent here and the top bar's Back falls back to the
 * catalog instead of the agent page.
 */
export function MarkAgentUnavailable({ agentId }: { agentId: string }) {
  useMarkAgentUnavailable(agentId);
  return null;
}

export { useIsAgentUnavailable };
