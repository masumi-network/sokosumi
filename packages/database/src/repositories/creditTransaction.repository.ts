import type { CreditTransaction, Prisma } from "../generated/prisma/client.js";

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
    tx: Prisma.TransactionClient,
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
    tx: Prisma.TransactionClient,
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
    tx: Prisma.TransactionClient,
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
    tx: Prisma.TransactionClient,
  ): Promise<CreditTransaction | null> {
    return await tx.creditTransaction.findFirst({
      where: { job: { id: jobId } },
      include: {
        job: true,
      },
    });
  },

  /**
   * Creates a credit transaction from a Stripe payment (session or invoice).
   * This method is idempotent - if a transaction with the same referenceId and referenceType already exists, it returns the existing transaction.
   *
   * @param userId - The ID of the user associated with the transaction.
   * @param organizationId - The ID of the organization, or null if not applicable.
   * @param cents - The amount in cents (bigint) representing credits to grant.
   * @param referenceId - The Stripe session ID or invoice ID for idempotency tracking.
   * @param referenceType - The type of reference ("STRIPE_SESSION" or "STRIPE_INVOICE").
   * @param tx - The Prisma transaction client to use for database operations.
   * @returns The created or existing CreditTransaction object.
   */
  async createCreditTransactionFromPayment(
    userId: string,
    organizationId: string | null,
    cents: bigint,
    referenceId: string,
    referenceType: "STRIPE_SESSION" | "STRIPE_INVOICE",
    tx: Prisma.TransactionClient,
  ): Promise<CreditTransaction> {
    // Check for existing transaction with matching referenceId and referenceType (idempotency)
    const existing = await tx.creditTransaction.findFirst({
      where: {
        referenceId,
        referenceType,
      },
    });

    if (existing) {
      return existing;
    }

    // Create new credit transaction
    return await tx.creditTransaction.create({
      data: {
        amount: cents,
        user: { connect: { id: userId } },
        ...(organizationId && {
          organization: { connect: { id: organizationId } },
        }),
        referenceId,
        referenceType,
      },
    });
  },
};
