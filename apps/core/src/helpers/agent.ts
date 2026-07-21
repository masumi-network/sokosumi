import {
  type Agent,
  type AgentMetadataOverride,
  AgentStatus,
  type CreditCost,
  PricingType,
  type Prisma,
} from "@sokosumi/database";
import type { Agent as MasumiAgent } from "@sokosumi/masumi/types";
import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";

import { TIME } from "@/config/constants";
import prisma from "@/lib/db/prisma";
import {
  type AgentMyReview,
  type AgentReview,
  agentMyReviewSchema,
  agentReviewSchema,
  type RatingDistribution,
  type RatingMetrics,
} from "@/schemas/agent.schema";
import type { AgentWithPricing } from "@/types/agent";

import { internalServerError, notFound, unprocessableEntity } from "./error";

type AgentMetadataOverrideScalars = AgentMetadataOverride;

export const getAgentImage = (
  agent: Pick<Agent, "image"> & {
    metadataOverride?: Pick<AgentMetadataOverrideScalars, "image"> | null;
  },
): string | null => {
  const image = agent.metadataOverride?.image ?? agent.image;
  if (!image) {
    return null;
  }
  return resolveIpfsOrHttpUrl(image);
};

export const getAgentIcon = (agent: Pick<Agent, "icon">): string | null => {
  if (!agent.icon) {
    return null;
  }
  return resolveIpfsOrHttpUrl(agent.icon);
};

export const getAgentName = (
  agent: Pick<Agent, "name"> & {
    metadataOverride?: Pick<AgentMetadataOverrideScalars, "name"> | null;
  },
): string => {
  return agent.metadataOverride?.name ?? agent.name;
};

export const getAgentDescription = (
  agent: Pick<Agent, "description"> & {
    metadataOverride?: Pick<AgentMetadataOverrideScalars, "description"> | null;
  },
): string | null => {
  return agent.metadataOverride?.description ?? agent.description;
};

export const getAgentAuthorImage = (
  agent: Pick<Agent, "authorImage"> & {
    metadataOverride?: Partial<
      Pick<AgentMetadataOverrideScalars, "authorImage">
    > | null;
  },
): string | null => {
  const image = agent.metadataOverride?.authorImage ?? agent.authorImage;
  if (!image) {
    return null;
  }
  return resolveIpfsOrHttpUrl(image);
};

export function toMasumiAgent(
  agent: Pick<Agent, "id" | "name" | "blockchainIdentifier" | "apiBaseUrl"> & {
    metadataOverride?: Pick<AgentMetadataOverrideScalars, "apiBaseUrl"> | null;
  },
): MasumiAgent {
  return {
    id: agent.id,
    name: agent.name,
    blockchainIdentifier: agent.blockchainIdentifier,
    apiBaseUrl: agent.apiBaseUrl,
    metadataOverride: agent.metadataOverride
      ? { apiBaseUrl: agent.metadataOverride.apiBaseUrl }
      : null,
  };
}

export interface JobDetailsAgentOverrideFields {
  overrideName: string | null;
  overrideImage: string | null;
  overrideLegalPrivacyPolicy: string | null;
  overrideLegalTerms: string | null;
  overrideLegalDpa: string | null;
  overrideLegalOther: string | null;
}

export function getJobDetailsAgentOverrideFields(agent: {
  metadataOverride?: Pick<
    AgentMetadataOverrideScalars,
    | "name"
    | "image"
    | "legalPrivacyPolicy"
    | "legalTerms"
    | "legalDpa"
    | "legalOther"
  > | null;
}): JobDetailsAgentOverrideFields {
  const override = agent.metadataOverride;
  return {
    overrideName: override?.name ?? null,
    overrideImage: override?.image ?? null,
    overrideLegalPrivacyPolicy: override?.legalPrivacyPolicy ?? null,
    overrideLegalTerms: override?.legalTerms ?? null,
    overrideLegalDpa: override?.legalDpa ?? null,
    overrideLegalOther: override?.legalOther ?? null,
  };
}

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

/**
 * Asserts that an agent exists and is available (ONLINE, shown, valid pricing),
 * throwing a 404 otherwise. Centralizes the availability existence check shared
 * by the agent rating sub-resource handlers (rating upsert and eligibility).
 */
export const requireAvailableAgentOrThrow = async (
  agentId: string,
  tx: Prisma.TransactionClient,
): Promise<void> => {
  const creditCosts = await getCreditCostsOrThrow(tx);
  const agent = await tx.agent.findFirst({
    where: {
      id: agentId,
      ...buildAvailableAgentWhereClause(creditCosts),
    },
    select: { id: true },
  });

  if (!agent) {
    throw notFound("Agent not found");
  }
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
 * Converts on-chain pricing rows (unit + amount in smallest units) to billable cents
 * using the CreditCost table. Used for fixed agent pricing and task masumi payments.
 */
function calculateCentsFromPricingAmountRows(
  rows: readonly { unit: string; amount: bigint }[],
  creditCosts: CreditCost[],
): bigint {
  let totalCents = BigInt(0);
  for (const row of rows) {
    const creditCost = creditCosts.find((c) => c.unit === row.unit);
    if (!creditCost) {
      throw unprocessableEntity(`Credit cost not found for unit ${row.unit}`);
    }
    totalCents += row.amount * creditCost.centsPerUnit;
  }
  return totalCents;
}

/**
 * Parses Masumi payment Amounts (string amounts) and returns billable cents.
 */
export function calculateCentsFromMasumiAmountStrings(
  amounts: readonly { amount: string; unit: string }[],
  creditCosts: CreditCost[],
): bigint {
  if (amounts.length === 0) {
    throw unprocessableEntity("Amounts must not be empty");
  }

  const rows: { unit: string; amount: bigint }[] = [];
  for (const entry of amounts) {
    let amount: bigint;
    try {
      amount = BigInt(entry.amount);
    } catch {
      throw unprocessableEntity(`Invalid amount: ${entry.amount}`);
    }
    if (amount <= 0n) {
      throw unprocessableEntity("Amount must be positive");
    }
    if (entry.unit.trim().length === 0) {
      throw unprocessableEntity("Unit must not be empty");
    }
    rows.push({ unit: entry.unit, amount });
  }

  return calculateCentsFromPricingAmountRows(rows, creditCosts);
}

/**
 * Calculates the cost for an agent from its pricing configuration.
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

      return {
        cents: calculateCentsFromPricingAmountRows(pricing, creditCosts),
      };
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
 * created within the lookback period
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
 * that were created within the lookback period
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
    where: {
      agentId,
      isHidden: false,
    },
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
      isHidden: false,
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

export const getAgentRatingDistribution = async (
  agentId: string,
  tx: Prisma.TransactionClient,
): Promise<RatingDistribution> => {
  const ratings = await tx.userAgentRating.groupBy({
    by: ["rating"],
    where: {
      agentId,
      isHidden: false,
    },
    _count: { rating: true },
  });

  const distribution: RatingDistribution = {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
  };

  ratings.forEach((rating) => {
    const key = String(rating.rating) as keyof RatingDistribution;
    distribution[key] = rating._count.rating;
  });

  return distribution;
};

export const getRecentAgentReviews = async (
  agentId: string,
  limit: number,
  tx: Prisma.TransactionClient,
  offset: number = 0,
): Promise<AgentReview[]> => {
  const ratings = await tx.userAgentRating.findMany({
    where: {
      agentId,
      isHidden: false,
      AND: [{ comment: { not: null } }, { comment: { not: "" } }],
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          image: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });

  return ratings.map((rating) =>
    agentReviewSchema.parse({
      id: rating.id,
      rating: rating.rating,
      comment: rating.comment,
      createdAt: rating.createdAt,
      updatedAt: rating.updatedAt,
      user: {
        id: rating.user.id,
        name: rating.user.name,
        image: rating.user.image
          ? resolveIpfsOrHttpUrl(rating.user.image)
          : rating.user.image,
      },
    }),
  );
};

/**
 * Returns the authenticated caller's own rating for an agent, or null when they
 * have not rated it. Unlike the public review reads, this is not filtered by
 * `isHidden` — the caller may always see their own rating.
 */
export const getUserAgentReview = async (
  agentId: string,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<AgentMyReview | null> => {
  const rating = await tx.userAgentRating.findUnique({
    where: {
      userId_agentId: {
        userId,
        agentId,
      },
    },
  });

  if (!rating) {
    return null;
  }

  return agentMyReviewSchema.parse({
    id: rating.id,
    rating: rating.rating,
    comment: rating.comment,
  });
};

/**
 * Creates or updates the caller's rating for an agent. Callers are responsible
 * for enforcing the eligibility gate (a finished job with the agent) before
 * invoking this helper.
 */
export const upsertUserAgentReview = async (
  agentId: string,
  userId: string,
  rating: number,
  comment: string | null,
  tx: Prisma.TransactionClient,
): Promise<AgentMyReview> => {
  const upserted = await tx.userAgentRating.upsert({
    where: {
      userId_agentId: {
        userId,
        agentId,
      },
    },
    update: {
      rating,
      comment,
    },
    create: {
      userId,
      agentId,
      rating,
      comment,
    },
  });

  return agentMyReviewSchema.parse({
    id: upserted.id,
    rating: upserted.rating,
    comment: upserted.comment,
  });
};
