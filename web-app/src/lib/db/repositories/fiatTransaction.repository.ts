import "server-only";

import {
  FiatTransaction,
  FiatTransactionStatus,
  Prisma,
} from "@/prisma/generated/client";

import prisma from "./prisma";

/**
 * Fiat Transaction Repository Interface
 *
 * Exports all fiat transaction data access methods as a single object
 * for consistent repository pattern usage.
 */
export const fiatTransactionRepository = {
  /**
   * Creates a new fiat transaction for a user (and optionally an organization).
   *
   * @param userId - The ID of the user associated with the transaction.
   * @param organizationId - The ID of the organization, or null if not applicable.
   * @param cents - The amount in cents (bigint).
   * @param amount - The fiat amount (number, e.g., dollars).
   * @param currency - The currency code (e.g., "usd").
   * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @returns The created FiatTransaction object.
   */
  async createFiatTransaction(
    userId: string,
    organizationId: string | null,
    cents: bigint,
    amount: number,
    currency: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<FiatTransaction> {
    return await tx.fiatTransaction.create({
      data: {
        user: { connect: { id: userId } },
        ...(organizationId && {
          organization: { connect: { id: organizationId } },
        }),
        cents,
        amount,
        currency,
      },
    });
  },

  /**
   * Retrieves a fiat transaction by its associated service payment ID (e.g., Stripe session ID).
   *
   * @param servicePaymentId - The external service payment/session ID.
   * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @returns The matching FiatTransaction object, or null if not found.
   */
  async getFiatTransactionByServicePaymentId(
    servicePaymentId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<FiatTransaction | null> {
    return await tx.fiatTransaction.findUnique({
      where: { servicePaymentId },
    });
  },

  /**
   * Updates a fiat transaction by its ID with the provided data.
   *
   * @param id - The ID of the fiat transaction to update.
   * @param data - The update data (Prisma.FiatTransactionUpdateInput).
   * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @returns The updated FiatTransaction object.
   */
  async updateFiatTransaction(
    id: string,
    data: Prisma.FiatTransactionUpdateInput,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<FiatTransaction> {
    return await tx.fiatTransaction.update({
      where: { id },
      data,
    });
  },

  /**
   * Updates the status, amount, and currency of a fiat transaction.
   * If the status is set to SUCCEEDED, a corresponding credit transaction is created.
   *
   * @param fiatTransaction - The FiatTransaction object to update.
   * @param amount - The new amount (bigint, in cents).
   * @param currency - The new currency code.
   * @param status - The new status (FiatTransactionStatus).
   * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @returns The updated FiatTransaction object.
   */
  async updateFiatTransactionStatus(
    fiatTransaction: FiatTransaction,
    amount: bigint,
    currency: string,
    status: FiatTransactionStatus,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<FiatTransaction> {
    // Build credit transaction data based on whether it's for a user or organization
    const creditTransactionData = {
      amount: fiatTransaction.cents,
      user: { connect: { id: fiatTransaction.userId } },
      ...(fiatTransaction.organizationId && {
        organization: { connect: { id: fiatTransaction.organizationId } },
      }),
    };

    return await tx.fiatTransaction.update({
      where: { id: fiatTransaction.id },
      data: {
        status,
        amount,
        currency,
        ...(status === FiatTransactionStatus.SUCCEEDED && {
          creditTransaction: {
            create: creditTransactionData,
          },
        }),
      },
    });
  },
};
