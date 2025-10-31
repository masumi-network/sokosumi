import "server-only";

import prisma from "../client";
import type { CreditCost, Prisma } from "../generated/prisma/client";

/**
 * Credit Cost Repository Interface
 *
 * Exports all credit cost data access methods as a single object
 * for consistent repository pattern usage.
 */
export const creditCostRepository = {
  /**
   * Retrieves a credit cost record by its unit identifier.
   *
   * @param unit - The unique unit identifier (e.g., "token", "api_call", "compute_second")
   * @param tx - Optional Prisma transaction client for database operations within a transaction
   * @returns Promise resolving to the CreditCost record or null if not found
   *
   */
  async getCreditCostByUnit(
    unit: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<CreditCost | null> {
    return await tx.creditCost.findUnique({
      where: {
        unit,
      },
    });
  },

  /**
   * Retrieves all credit cost records from the database.
   *
   * @param tx - Optional Prisma transaction client for database operations within a transaction
   * @returns Promise resolving to an array of all CreditCost records
   *
   */
  async getCreditCosts(
    tx: Prisma.TransactionClient = prisma,
  ): Promise<CreditCost[]> {
    return await tx.creditCost.findMany();
  },
};
