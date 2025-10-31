
import prisma from "../client";
import type { CreditTransaction, Prisma } from "../generated/prisma/client";

/**
 * Credit Transaction Repository Interface
 *
 * Exports all credit transaction data access methods as a single object
 * for consistent repository pattern usage.
 */
export const creditTransactionRepository = {
  /**
   * Get the total credit balance (in cents) for a given user.
   *
   * This function aggregates all credit transactions for the specified user and sums the 'amount' field.
   * If the user has no credit transactions, it returns 0n (bigint zero).
   *
   * @param userId - The ID of the user whose credit balance is being retrieved.
   * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @returns The total credit balance in cents as a bigint.
   */
  async getCentsByUserId(
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<bigint> {
    return await this.getCentsByWhere({ userId, organizationId: null }, tx);
  },

  /**
   * Get the total credit balance (in cents) for a given organization.
   *
   * This function aggregates all credit transactions for the specified organization and sums the 'amount' field.
   * If the organization has no credit transactions, it returns 0n (bigint zero).
   *
   * @param organizationId - The ID of the organization whose credit balance is being retrieved.
   * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @returns The total credit balance in cents as a bigint.
   */
  async getCentsByOrganizationId(
    organizationId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<bigint> {
    return await this.getCentsByWhere({ organizationId }, tx);
  },

  /**
   * Get the total credit balance (in cents) for a given where clause.
   *
   * This function aggregates all credit transactions for the specified where clause and sums the 'amount' field.
   * If there are no credit transactions, it returns 0n (bigint zero).
   *
   * @param where - The where clause to filter credit transactions.
   * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @returns The total credit balance in cents as a bigint.
   */
  async getCentsByWhere(
    where: Prisma.CreditTransactionWhereInput,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<bigint> {
    const centsBalance = await tx.creditTransaction.aggregate({
      where,
      _sum: {
        amount: true,
      },
    });
    return centsBalance._sum.amount ?? BigInt(0);
  },

  /**
   * Retrieves the credit transaction associated with a specific job.
   *
   * This function searches for the first credit transaction linked to the given job ID.
   * It includes the related job data in the result.
   *
   * @param jobId - The ID of the job whose credit transaction is being retrieved.
   * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @returns The credit transaction associated with the job, or null if not found.
   */
  async getCreditTransactionByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<CreditTransaction | null> {
    return await tx.creditTransaction.findFirst({
      where: { job: { id: jobId } },
      include: {
        job: true,
      },
    });
  },
};
