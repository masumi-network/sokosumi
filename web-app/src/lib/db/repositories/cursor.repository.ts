import prisma from "@/lib/db/repositories/prisma";
import { Cursor, Prisma } from "@/prisma/generated/client";

/**
 * Repository for managing StripeCleanupCursor entity.
 * Provides methods for tracking the cursor position in Stripe cleanup operations.
 */
export const cursorRepository = {
  /**
   * Gets the current cursor position for Stripe cleanup.
   *
   * @param tx - Optional Prisma transaction client.
   * @returns The cursor record or null if it doesn't exist.
   */
  async getCursor(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Cursor | null> {
    return await tx.cursor.findUnique({
      where: { id },
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
    id: string,
    cursor: string | null,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Cursor> {
    return await tx.cursor.upsert({
      where: { id },
      update: { cursor },
      create: { id, cursor },
    });
  },

  /**
   * Resets the cursor to null, indicating cleanup should start from the beginning.
   *
   * @param tx - Optional Prisma transaction client.
   * @returns The updated cursor record.
   */
  async resetCursor(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Cursor> {
    return await this.setCursor(id, null, tx);
  },
};
