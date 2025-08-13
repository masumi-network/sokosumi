import prisma from "@/lib/db/repositories/prisma";
import { Prisma, StripeCleanupCursor } from "@/prisma/generated/client";

/**
 * Repository for managing StripeCleanupCursor entity.
 * Provides methods for tracking the cursor position in Stripe cleanup operations.
 */
export const stripeCleanupCursorRepository = {
  /**
   * Gets the current cursor position for Stripe cleanup.
   *
   * @param tx - Optional Prisma transaction client.
   * @returns The cursor record or null if it doesn't exist.
   */
  async getCursor(
    tx: Prisma.TransactionClient = prisma,
  ): Promise<StripeCleanupCursor | null> {
    return await tx.stripeCleanupCursor.findUnique({
      where: { id: "stripe-cleanup-cursor" },
    });
  },

  /**
   * Updates or creates the cursor position for Stripe cleanup.
   *
   * @param cursor - The cursor position (Stripe customer ID) or null to reset.
   * @param tx - Optional Prisma transaction client.
   * @returns The updated cursor record.
   */
  async setCursor(
    cursor: string | null,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<StripeCleanupCursor> {
    return await tx.stripeCleanupCursor.upsert({
      where: { id: "stripe-cleanup-cursor" },
      update: { cursor },
      create: { id: "stripe-cleanup-cursor", cursor },
    });
  },

  /**
   * Resets the cursor to null, indicating cleanup should start from the beginning.
   *
   * @param tx - Optional Prisma transaction client.
   * @returns The updated cursor record.
   */
  async resetCursor(
    tx: Prisma.TransactionClient = prisma,
  ): Promise<StripeCleanupCursor> {
    return await this.setCursor(null, tx);
  },
};
