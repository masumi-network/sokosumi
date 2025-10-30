import "server-only";

import prisma from "../client";
import type {
  FiatTransaction,
  FiatTransactionStatus,
  Prisma,
} from "../generated/prisma/client";

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
   * Sets the service payment ID for a fiat transaction.
   *
   * @param id - The ID of the fiat transaction to update.
   * @param servicePaymentId - The new service payment ID.
   * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
   * @returns The updated FiatTransaction object.
   */
  async setFiatTransactionServicePaymentId(
    id: string,
    servicePaymentId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<FiatTransaction> {
    return await tx.fiatTransaction.update({
      where: { id },
      data: { servicePaymentId },
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
        ...(status === "SUCCEEDED" && {
          creditTransaction: {
            create: creditTransactionData,
          },
        }),
      },
    });
  },

  /**
   * Creates a fiat transaction from a paid invoice and automatically creates the associated credit transaction.
   * This combines the creation, status update, and service payment ID assignment into a single atomic operation.
   *
   * @param userId - The ID of the user associated with the transaction.
   * @param organizationId - The ID of the organization, or null if not applicable.
   * @param cents - The amount in cents (bigint) representing credits.
   * @param invoiceId - The Stripe invoice ID.
   * @param amountPaid - The amount paid in the invoice (in cents).
   * @param currency - The currency code (e.g., "usd").
   * @param tx - (Optional) The Prisma transaction client to use for database operations.
   * @returns The created FiatTransaction object with the credit transaction.
   */
  async createFiatTransactionFromInvoice(
    userId: string,
    organizationId: string | null,
    cents: bigint,
    invoiceId: string,
    amountPaid: number,
    currency: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<FiatTransaction> {
    // Create the fiat transaction with SUCCEEDED status and credit transaction in one operation
    return await tx.fiatTransaction.create({
      data: {
        user: { connect: { id: userId } },
        ...(organizationId && {
          organization: { connect: { id: organizationId } },
        }),
        cents,
        amount: BigInt(amountPaid),
        currency,
        status: "SUCCEEDED",
        servicePaymentId: invoiceId,
        // Create the credit transaction immediately since status is SUCCEEDED
        creditTransaction: {
          create: {
            amount: cents,
            user: { connect: { id: userId } },
            ...(organizationId && {
              organization: { connect: { id: organizationId } },
            }),
          },
        },
      },
      include: {
        creditTransaction: true,
      },
    });
  },
};
