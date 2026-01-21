import type { Prisma, Transaction } from "../generated/prisma/client.js";

/**
 * Transaction Repository Interface
 *
 * Exports all transaction data access methods as a single object
 * for consistent repository pattern usage.
 */
export const transactionRepository = {
  /**
   * Get the total credit balance (in cents) for a given user.
   *
   * This function aggregates all transactions for the specified user and sums the 'amount' field.
   * If the user has no transactions, it returns 0n (bigint zero).
   *
   * @param userId - The ID of the user whose credit balance is being retrieved.
   * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @returns The total credit balance in cents as a bigint.
   */
  async getCentsByUserId(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<bigint> {
    return await this.getCentsByWhere({ userId, organizationId: null }, tx);
  },

  /**
   * Get the total credit balance (in cents) for a given organization.
   *
   * This function aggregates all transactions for the specified organization and sums the 'amount' field.
   * If the organization has no transactions, it returns 0n (bigint zero).
   *
   * @param organizationId - The ID of the organization whose credit balance is being retrieved.
   * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @returns The total credit balance in cents as a bigint.
   */
  async getCentsByOrganizationId(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<bigint> {
    return await this.getCentsByWhere({ organizationId }, tx);
  },

  /**
   * Get the total credit balance (in cents) for a given where clause.
   *
   * This function aggregates all transactions for the specified where clause and sums the 'amount' field.
   * If there are no transactions, it returns 0n (bigint zero).
   *
   * @param where - The where clause to filter transactions.
   * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @returns The total credit balance in cents as a bigint.
   */
  async getCentsByWhere(
    where: Prisma.TransactionWhereInput,
    tx: Prisma.TransactionClient,
  ): Promise<bigint> {
    const centsBalance = await tx.transaction.aggregate({
      where,
      _sum: {
        amount: true,
      },
    });
    return centsBalance._sum.amount ?? BigInt(0);
  },

  /**
   * Retrieves the transaction associated with a specific job.
   *
   * This function searches for the first transaction linked to the given job ID.
   * It includes the related job data in the result.
   *
   * @param jobId - The ID of the job whose transaction is being retrieved.
   * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @returns The transaction associated with the job, or null if not found.
   */
  async getTransactionByJobId(
    jobId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Transaction | null> {
    return await tx.transaction.findFirst({
      where: { job: { id: jobId } },
      include: {
        job: true,
      },
    });
  },
};
