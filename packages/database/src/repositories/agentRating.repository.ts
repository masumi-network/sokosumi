import prisma from "../client";
import type { Prisma } from "../generated/prisma/client";
import type {
  AgentRatingStats,
  UserAgentRatingWithUser,
} from "../types/agentRating";

export const agentRatingRepository = {
  /**
   * Create or update a user's rating for an agent (atomic upsert)
   * @param rating - Integer rating from 1 to 5 (inclusive)
   */
  async upsertRating(
    userId: string,
    agentId: string,
    rating: number,
    comment: string | null = null,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<void> {
    await tx.userAgentRating.upsert({
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
  },

  /**
   * Get a user's existing rating for an agent
   */
  async getUserRatingForAgent(
    userId: string,
    agentId: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return await tx.userAgentRating.findUnique({
      where: {
        userId_agentId: {
          userId,
          agentId,
        },
      },
    });
  },

  /**
   * Get rating distribution (count per star rating)
   */
  async getRatingDistribution(
    agentId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Record<number, number>> {
    const ratings = await tx.userAgentRating.groupBy({
      by: ["rating"],
      where: { agentId },
      _count: { rating: true },
    });

    // Initialize all star ratings to 0
    const distribution: Record<number, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };

    // Populate with actual counts
    ratings.forEach((r) => {
      distribution[r.rating] = r._count.rating;
    });

    return distribution;
  },

  /**
   * Get paginated ratings for an agent with user information
   */
  async getRatingsByAgentId(
    agentId: string,
    limit: number = 10,
    offset: number = 0,
    commentsOnly: boolean = false,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<UserAgentRatingWithUser[]> {
    const ratings = await tx.userAgentRating.findMany({
      where: {
        agentId,
        ...(commentsOnly ? { comment: { not: null } } : {}),
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
      orderBy: { createdAt: "desc" }, // Latest first
      take: limit,
      skip: offset,
    });

    return ratings.map((rating) => ({
      id: rating.id,
      rating: rating.rating,
      comment: rating.comment,
      createdAt: rating.createdAt,
      updatedAt: rating.updatedAt,
      user: {
        id: rating.user.id,
        name: rating.user.name,
        image: rating.user.image,
      },
    }));
  },

  /**
   * Get aggregate rating statistics for multiple agents
   */
  async getAgentsRatingStats(
    agentIds: string[],
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Record<string, AgentRatingStats>> {
    if (agentIds.length === 0) {
      return {};
    }

    const results = await tx.userAgentRating.groupBy({
      by: ["agentId"],
      where: {
        agentId: { in: agentIds },
      },
      _count: { rating: true },
      _avg: { rating: true },
    });

    const ratingStatsMap: Record<string, AgentRatingStats> = {};

    // Initialize all agents with zero ratings
    agentIds.forEach((agentId) => {
      ratingStatsMap[agentId] = {
        totalRatings: 0,
        averageRating: 0,
      };
    });

    // Update with actual data
    results.forEach((result) => {
      ratingStatsMap[result.agentId] = {
        totalRatings: result._count.rating,
        averageRating: result._avg.rating ?? 0,
      };
    });

    return ratingStatsMap;
  },

  /**
   * Get aggregate rating statistics for an agent
   */
  async getAgentRatingStats(
    agentId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<AgentRatingStats> {
    const result = await tx.userAgentRating.aggregate({
      where: { agentId },
      _count: { rating: true },
      _avg: { rating: true },
    });

    const totalRatings = result._count.rating;
    const averageRating = result._avg.rating ?? 0;

    return {
      totalRatings,
      averageRating,
    };
  },
};
