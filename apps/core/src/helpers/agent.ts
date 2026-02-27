import {
  type Agent,
  AgentStatus,
  type CreditCost,
  PricingType,
  type Prisma,
} from "@sokosumi/database";

import { TIME } from "@/config/constants";
import prisma from "@/lib/db/prisma";
import { type RatingMetrics } from "@/schemas/agent.schema";
import type { AgentWithPricing } from "@/types/agent";

import { internalServerError, unprocessableEntity } from "./error";
import { ipfsUrlResolver } from "./ipfs";

export const getAgentImage = (agent: Agent): string | null => {
  const image = agent.overrideImage ?? agent.image;
  if (!image) {
    return null;
  }
  return ipfsUrlResolver(image);
};

export const getAgentIcon = (agent: Agent): string | null => {
  if (!agent.icon) {
    return null;
  }
  return ipfsUrlResolver(agent.icon);
};

export const getAgentName = (agent: Agent): string => {
  return agent.overrideName ?? agent.name;
};

export const getAgentDescription = (agent: Agent): string | null => {
  return agent.overrideDescription ?? agent.description;
};

export const getAgentAuthorImage = (agent: Agent): string | null => {
  const image = agent.overrideAuthorImage ?? agent.authorImage;
  if (!image) {
    return null;
  }
  return ipfsUrlResolver(image);
};

/**
 * Retrieves credit costs used for agent availability and pricing checks.
 * Throws when credit costs are missing because these checks depend on a configured unit table.
 */
export const getCreditCostsOrThrow = async (
  tx: Prisma.TransactionClient = prisma,
): Promise<CreditCost[]> => {
  const creditCosts = await tx.creditCost.findMany();
  if (creditCosts.length === 0) {
    throw internalServerError("Failed to get credit information for agents");
  }
  return creditCosts;
};

/**
 * Builds a Prisma where clause for filtering agents by availability and valid pricing.
 *
 * Availability rules:
 * - Only shows agents with status ONLINE and isShown: true
 *
 * Pricing validation rules:
 * - Exclude agents with pricingType UNKNOWN
 * - For FIXED pricing: require fixedPricing exists and has non-empty amounts
 * - For FIXED pricing: ensure all amount units exist in CreditCost table
 * - FREE pricing is always valid (no additional validation needed)
 *
 * @param creditCosts - Array of credit costs to validate pricing units against
 * @returns Prisma where clause for agent queries
 */
export const buildAvailableAgentWhereClause = (
  creditCosts: CreditCost[],
): Prisma.AgentWhereInput => {
  const validUnits = creditCosts.map((c) => c.unit);

  const pricingFilter = {
    pricingType: { not: PricingType.UNKNOWN },
    OR: [
      { pricingType: PricingType.FREE },
      {
        pricingType: PricingType.FIXED,
        fixedPricing: {
          amounts: {
            every: {
              unit: { in: validUnits },
            },
          },
        },
      },
    ],
  };

  return {
    status: AgentStatus.ONLINE,
    isShown: true,
    pricing: pricingFilter,
  };
};

export interface AgentCost {
  cents: bigint;
}

/**
 * Gets an agent's cost.
 * @param agent - The agent with pricing.
 * @param creditCosts - The credit costs.
 * @returns The cost for the agent.
 */
export const getAgentCost = (
  agent: AgentWithPricing,
  creditCosts: CreditCost[],
): AgentCost => {
  return calculateAgentCost(agent, creditCosts);
};

/**
 * This function calculates the cost for an agent.
 * @param agent - The agent with pricing.
 * @param creditCosts - The credit costs.
 * @returns The cost for the agent.
 */
const calculateAgentCost = (
  agent: AgentWithPricing,
  creditCosts: CreditCost[],
): AgentCost => {
  switch (agent.pricing.pricingType) {
    case PricingType.FIXED: {
      if (
        !agent.pricing.fixedPricing ||
        agent.pricing.fixedPricing.amounts.length === 0
      ) {
        throw unprocessableEntity("Agent has invalid or unknown pricing");
      }
      const pricing = agent.pricing.fixedPricing.amounts.map((amount) => ({
        unit: amount.unit,
        amount: amount.amount,
      }));

      let totalCents = BigInt(0);
      for (const amount of pricing) {
        const creditCost = creditCosts.find(
          (creditCost) => creditCost.unit === amount.unit,
        );
        if (!creditCost) {
          throw unprocessableEntity(
            `Credit cost not found for unit ${amount.unit}`,
          );
        }
        const cents = amount.amount * creditCost.centsPerUnit;
        totalCents += cents;
      }

      return { cents: totalCents };
    }
    case PricingType.FREE: {
      return { cents: BigInt(0) };
    }
    case PricingType.UNKNOWN: {
      throw unprocessableEntity("Agent has invalid or unknown pricing");
    }
  }
};

/**
 * Calculates the average execution time (in seconds) for a given agent's jobs.
 *
 * The function looks at all jobs associated with the specified agent ID,
 * excluding jobs of type 'DEMO', created within the lookback period
 * (see TIME.AGENT_EXECUTION_METRICS_DAYS). For each job, it determines the
 * most recent 'COMPLETED' event and calculates the duration from job creation to completion.
 *
 * The function returns the average duration in seconds as a number, or null
 * if no qualifying jobs exist.
 *
 * @param agentId - The ID of the agent whose average execution time is to be calculated.
 * @param tx - The Prisma transaction client used to run the raw SQL query.
 * @returns A Promise that resolves to the average execution time in seconds (number), or null if unavailable.
 */
export const calculateAverageExecutionTime = async (
  agentId: string,
  tx: Prisma.TransactionClient,
): Promise<number | null> => {
  // Calculate cutoff date in JavaScript to avoid SQL injection risk
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - TIME.AGENT_EXECUTION_METRICS_DAYS);

  const result = await tx.$queryRawUnsafe<
    [{ avg_duration_seconds: typeof Prisma.Decimal | null }]
  >(
    `
    SELECT 
      AVG(EXTRACT(EPOCH FROM (completed_event."createdAt" - j."createdAt"))) as avg_duration_seconds
    FROM "Job" j
    INNER JOIN LATERAL (
      SELECT js."createdAt"
      FROM "jobEvent" js
      WHERE js."jobId" = j.id
      AND js."status" = 'COMPLETED'::"AgentJobStatus"
      ORDER BY js."createdAt" DESC
      LIMIT 1
    ) completed_event ON true
    WHERE j."agentId" = $1
    AND j."jobType" != 'DEMO'
    AND j."createdAt" >= $2
    `,
    agentId,
    cutoffDate,
  );
  const averageDurationSeconds = result[0]?.avg_duration_seconds ?? null;
  return averageDurationSeconds ? averageDurationSeconds.toNumber() : null;
};

/**
 * Calculates the average execution times (in seconds) for multiple agents' jobs.
 *
 * This function examines all jobs associated with each specified agent ID
 * (excluding jobs of type 'DEMO') that were created within the lookback period
 * (see TIME.AGENT_EXECUTION_METRICS_DAYS). For each job, it finds the most recent
 * 'COMPLETED' job event and calculates the duration from the job's creation to its completion.
 *
 * The average duration in seconds is computed per agent.
 *
 * If an agent has no qualifying jobs, the returned map will contain a null value for that agent.
 *
 * @param agentIds - An array of agent IDs for which to calculate average execution times.
 * @param tx - The Prisma transaction client used to execute the raw SQL query.
 * @returns A Promise resolving to a Map where the key is the agent ID and the value is
 *          the average execution time in seconds (as a number) for that agent, or null if unavailable.
 */
export const calculateAverageExecutionTimes = async (
  agentIds: string[],
  tx: Prisma.TransactionClient,
): Promise<Map<string, number | null>> => {
  if (agentIds.length === 0) return new Map();

  // Calculate cutoff date in JavaScript to avoid SQL injection risk
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - TIME.AGENT_EXECUTION_METRICS_DAYS);

  const averages = await tx.$queryRawUnsafe<
    Array<{
      agent_id: string;
      avg_duration_seconds: typeof Prisma.Decimal | null;
    }>
  >(
    `
    SELECT 
      j."agentId" as agent_id,
      AVG(EXTRACT(EPOCH FROM (completed_event."createdAt" - j."createdAt"))) as avg_duration_seconds
    FROM "Job" j
    INNER JOIN LATERAL (
      SELECT js."createdAt"
      FROM "jobEvent" js
      WHERE js."jobId" = j.id
      AND js."status" = 'COMPLETED'::"AgentJobStatus"
      ORDER BY js."createdAt" DESC
      LIMIT 1
    ) completed_event ON true
    WHERE j."agentId" = ANY($1::text[])
    AND j."jobType" != 'DEMO'
    AND j."createdAt" >= $2
    GROUP BY j."agentId"
    `,
    agentIds,
    cutoffDate,
  );

  // Create a map with all agentIds, defaulting to null for those without data
  const averagesMap = new Map<string, number | null>();

  // Initialize all agentIds with null
  for (const agentId of agentIds) {
    averagesMap.set(agentId, null);
  }

  // Set the actual values for agents that have data
  for (const average of averages) {
    averagesMap.set(
      average.agent_id,
      average.avg_duration_seconds
        ? average.avg_duration_seconds.toNumber()
        : null,
    );
  }

  return averagesMap;
};

export const calculateAgentRating = async (
  agentId: string,
  tx: Prisma.TransactionClient,
): Promise<RatingMetrics> => {
  const ratingStats = await tx.userAgentRating.aggregate({
    where: { agentId },
    _count: { rating: true },
    _avg: { rating: true },
  });
  return {
    total: ratingStats._count.rating ?? 0,
    average: ratingStats._avg.rating ?? null,
  };
};

export const calculateAgentRatings = async (
  agentIds: string[],
  tx: Prisma.TransactionClient,
): Promise<Map<string, RatingMetrics>> => {
  if (agentIds.length === 0) return new Map();

  const ratings = await tx.userAgentRating.groupBy({
    by: ["agentId"],
    where: {
      agentId: { in: agentIds },
    },
    _count: { rating: true },
    _avg: { rating: true },
  });

  // Convert array to Map for O(1) lookups
  const ratingsMap = new Map(
    ratings.map((rating) => [
      rating.agentId,
      {
        total: rating._count.rating,
        average: rating._avg.rating,
      },
    ]),
  );

  // Initialize all agentIds with default values (for agents with no ratings)
  for (const agentId of agentIds) {
    if (!ratingsMap.has(agentId)) {
      ratingsMap.set(agentId, {
        total: 0,
        average: null,
      });
    }
  }
  return ratingsMap;
};
