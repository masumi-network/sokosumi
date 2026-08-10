import {
  agentMetadataOverrideScalarsInclude,
  agentPricingInclude,
  type CreditCost,
  PricingType,
  type Prisma,
} from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/utils";

import {
  calculateAgentRatings,
  getAgentCost,
  getAgentDescription,
  getAgentIcon,
  getAgentImage,
  getAgentName,
} from "@/helpers/agent";
import {
  getAgentLegalFromAgent,
  getAuthorFromAgent,
} from "@/schemas/agent.schema";
import { mapCategoryForApi } from "@/schemas/category.schema";
import type { agentCategoriesInclude } from "@/types/agent";

/**
 * Agent row shape required to build a catalog-style agent summary: pricing,
 * denormalized jobCount, ordered categories, and optional metadata overrides.
 */
export type AgentSummaryRow = Prisma.AgentGetPayload<{
  include: typeof agentPricingInclude &
    typeof agentCategoriesInclude &
    typeof agentMetadataOverrideScalarsInclude;
}>;

/**
 * Maps already-fetched agent rows to the catalog summary shape returned by
 * `GET /v1/agents`: resolves overrides, computes per-agent credits from the
 * credit cost table, and attaches execution + rating metrics.
 *
 * List path skips average-execution SQL (`averageTime` is null); detail still
 * computes it. Execution count uses denormalized `Agent.jobCount`.
 */
export async function buildAgentSummaries(
  agents: AgentSummaryRow[],
  creditCosts: CreditCost[],
  tx: Prisma.TransactionClient,
) {
  const agentsWithCredits = agents
    .map((agent) => {
      // A registry replay rewrites pricing per agent (delete + recreate of the
      // amount rows), so a concurrent read can momentarily see FIXED pricing
      // with no amounts. That is one transient row, not a broken page: drop it
      // from this listing instead of failing the whole request.
      if (
        agent.pricing.pricingType === PricingType.FIXED &&
        (!agent.pricing.fixedPricing ||
          agent.pricing.fixedPricing.amounts.length === 0)
      ) {
        console.warn(
          `[agents] Skipping agent ${agent.id} during transient pricing rewrite`,
        );
        return null;
      }

      const cost = getAgentCost(agent, creditCosts);
      return {
        ...agent,
        credits: convertCentsToCredits(cost.cents),
      };
    })
    .filter((agent) => agent !== null)
    .map((agent) => ({
      ...agent,
      name: getAgentName(agent),
      description: getAgentDescription(agent),
      image: getAgentImage(agent),
      icon: getAgentIcon(agent),
      author: getAuthorFromAgent(agent),
      legal: getAgentLegalFromAgent(agent),
      categories: (agent.categories ?? []).map(mapCategoryForApi),
    }));

  const agentIds = agentsWithCredits.map((agent) => agent.id);
  const ratingsMap = await calculateAgentRatings(agentIds, tx);

  return agentsWithCredits.map((agent) => {
    const ratingMetrics = ratingsMap.get(agent.id);
    return {
      ...agent,
      metrics: {
        executions: {
          count: agent.jobCount,
          averageTime: null,
        },
        ratings: {
          total: ratingMetrics?.total ?? 0,
          average: ratingMetrics?.average ?? null,
        },
      },
    };
  });
}
