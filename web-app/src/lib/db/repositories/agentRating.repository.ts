import "server-only";

import { Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

export interface AgentRatingStats {
  totalRatings: number;
  averageRating: number;
  roundedRating: number; // Mathematical rounding: 3.5→4, 3.4→3
}

export interface UserAgentRatingWithUser {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    name: string;
    image: string | null;
  };
}

export const agentRatingRepository = {
  /**
   * Create or update a user's rating for an agent (atomic upsert)
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
   * Get paginated ratings for an agent with user information
   */
  async getRatingsByAgentId(
    agentId: string,
    limit: number = 10,
    offset: number = 0,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<UserAgentRatingWithUser[]> {
    const ratings = await tx.userAgentRating.findMany({
      where: { agentId },
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

    // Mathematical rounding: 3.5→4, 3.4→3
    const roundedRating = Math.round(averageRating);

    return {
      totalRatings,
      averageRating,
      roundedRating,
    };
  },
};
