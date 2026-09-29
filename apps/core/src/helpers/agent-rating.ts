import { JobType, OnChainJobStatus, type Prisma } from "@sokosumi/database";
import { finalizedAgentJobStatuses } from "@sokosumi/database/types/job";
import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";

import {
  type AgentMyReview,
  type AgentReview,
  agentMyReviewSchema,
  agentReviewSchema,
  type RatingDistribution,
  type RatingMetrics,
} from "@/schemas/agent.schema";

/**
 * User ratings and reviews of an agent: aggregates, the public review feed,
 * and the caller's own review.
 *
 * Split out of `./agent` (which owns identity, availability and rail
 * readiness) so each file carries one responsibility and stays inside the
 * 750-line ceiling — same move as `./agent-cost`. The one rule that spans
 * every read here: public aggregates and feeds filter `isHidden`, while the
 * caller's OWN review is always visible to them.
 */

/**
 * Finished: agent status Completed/Failed, and on-chain status is not
 * FUNDS_LOCKED, REFUND_REQUESTED, or REFUND_AUTHORIZED (authorized refund
 * still needs its on-chain withdrawal), or is null for FREE jobs.
 */
function finishedJobsWhere(): Prisma.JobWhereInput {
  return {
    AND: [
      {
        events: {
          some: {
            status: {
              in: finalizedAgentJobStatuses,
            },
          },
        },
        OR: [
          { purchase: { onChainStatus: null }, jobType: JobType.FREE },
          {
            purchase: {
              onChainStatus: {
                notIn: [
                  OnChainJobStatus.FUNDS_LOCKED,
                  OnChainJobStatus.REFUND_REQUESTED,
                  OnChainJobStatus.REFUND_AUTHORIZED,
                ],
              },
            },
          },
        ],
      },
    ],
  };
}

export async function doesUserHaveFinishedJobWithAgent(
  ownerId: string,
  agentId: string,
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  const jobCount = await tx.job.count({
    where: {
      ownerId,
      agentId,
      ...finishedJobsWhere(),
    },
  });

  return jobCount > 0;
}

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

  const ratingsMap = new Map(
    ratings.map((rating) => [
      rating.agentId,
      {
        total: rating._count.rating,
        average: rating._avg.rating,
      },
    ]),
  );

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
