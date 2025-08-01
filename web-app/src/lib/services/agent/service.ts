import "server-only";

import { AgentWithRelations } from "@/lib/db";
import { getAgentCreditsPrice } from "@/lib/services";

/**
 * Represents an agent with its calculated credit pricing information.
 */
export interface AgentWithCreditPrice {
  agent: AgentWithRelations;
  creditsPrice: Awaited<ReturnType<typeof getAgentCreditsPrice>>;
}
