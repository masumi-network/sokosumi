import { getAgentCost } from "@/helpers/agent-cost";
import type { NetworkScope } from "@/lib/db/network-scope";
import { agentDetailInclude } from "@/types/agent";
import {
  AGENT_PRICING_READ_TRANSACTION_OPTIONS,
  buildAvailableAgentWhereClause,
  getCardanoV2ReadySources,
  getCreditCostsOrThrow,
} from "./availability";

export async function getAvailableAgent(scope: NetworkScope, id: string) {
  const [creditCosts, cardanoV2ReadySources] = await Promise.all([
    getCreditCostsOrThrow(scope.networkDb.creditCost),
    getCardanoV2ReadySources(scope.sharedDb, scope.network),
  ]);

  // Nested pricing rows must share one snapshot. Credit-cost and Cardano
  // readiness are not that graph; metrics are not either. See
  // AGENT_PRICING_READ_TRANSACTION_OPTIONS. The current Prisma adapter elides
  // BEGIN for this single-operation batch, as the catalog recording shows.
  const [agent] = await scope.netBatch(
    (db) => [
      db.agent.findFirst({
        where: {
          id,
          ...buildAvailableAgentWhereClause(creditCosts, cardanoV2ReadySources),
        },
        include: agentDetailInclude,
      }),
    ],
    AGENT_PRICING_READ_TRANSACTION_OPTIONS.isolationLevel,
  );

  return agent ? { agent, cost: getAgentCost(agent, creditCosts) } : null;
}
