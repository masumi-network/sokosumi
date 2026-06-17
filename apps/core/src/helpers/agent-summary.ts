import type { CreditCost, Prisma } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/utils";

import {
  calculateAgentRatings,
  calculateAverageExecutionTimes,
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
import type {
  agentCategoriesInclude,
  agentJobsCountInclude,
  agentPricingInclude,
} from "@/types/agent";

/**
 * Agent row shape required to build a catalog-style agent summary: pricing,
 * job count and ordered categories.
 */
export type AgentSummaryRow = Prisma.AgentGetPayload<{
  include: typeof agentPricingInclude &
    typeof agentJobsCountInclude &
    typeof agentCategoriesInclude;
}>;

/**
 * Maps already-fetched agent rows to the catalog summary shape returned by
 * `GET /v1/agents`: resolves overrides, computes per-agent credits from the
 * credit cost table, and attaches execution + rating metrics.
 *
 * Keeps the catalog summary computation (credits + override resolution +
 * metrics) in a single place.
 */
export async function buildAgentSummaries(
  agents: AgentSummaryRow[],
  creditCosts: CreditCost[],
  tx: Prisma.TransactionClient,
) {
  const agentsWithCredits = agents
    .map((agent) => {
      const cost = getAgentCost(agent, creditCosts);
      return {
        ...agent,
        credits: convertCentsToCredits(cost.cents),
      };
    })
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

  const [averageExecutionTimes, ratingsMap] = await Promise.all([
    calculateAverageExecutionTimes(agentIds, tx),
    calculateAgentRatings(agentIds, tx),
  ]);

  return agentsWithCredits.map((agent) => {
    const ratingMetrics = ratingsMap.get(agent.id);
    return {
      ...agent,
      metrics: {
        executions: {
          count: agent._count.jobs,
          averageTime: averageExecutionTimes.get(agent.id) ?? null,
        },
        ratings: {
          total: ratingMetrics?.total ?? 0,
          average: ratingMetrics?.average ?? null,
        },
      },
    };
  });
}
