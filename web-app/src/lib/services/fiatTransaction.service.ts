import {
  FiatTransaction,
  FiatTransactionStatus,
} from "@/prisma/generated/client";

import { BaseService } from "./base.service";

export class FiatTransactionService extends BaseService<FiatTransactionService> {
  async createFiatTransaction(
    userId: string,
    organizationId: string | null,
    cents: bigint,
    amount: number,
    currency: string,
  ): Promise<FiatTransaction> {
    return await this.client.fiatTransaction.create({
      data: {
        userId,
        ...(organizationId && { organizationId }),
        cents,
        amount,
        currency,
      },
    });
  }

  async getFiatTransactionByServicePaymentId(
    servicePaymentId: string,
  ): Promise<FiatTransaction | null> {
    return await this.client.fiatTransaction.findUnique({
      where: { servicePaymentId },
    });
  }

  async updateFiatTransactionServicePaymentId(
    id: string,
    servicePaymentId: string,
  ): Promise<FiatTransaction> {
    return await this.client.fiatTransaction.update({
      where: { id },
      data: { servicePaymentId },
    });
  }

  async updateFiatTransactionStatusToSucceeded(
    fiatTransaction: FiatTransaction,
    amount: bigint,
    currency: string,
  ): Promise<FiatTransaction> {
    // Build credit transaction data based on whether it's for a user or organization
    const creditTransactionData = {
      amount: fiatTransaction.cents,
      user: { connect: { id: fiatTransaction.userId } },
      ...(fiatTransaction.organizationId && {
        organization: { connect: { id: fiatTransaction.organizationId } },
      }),
    };

    return await this.client.fiatTransaction.update({
      where: { id: fiatTransaction.id },
      data: {
        status: FiatTransactionStatus.SUCCEEDED,
        amount,
        currency,
        creditTransaction: {
          create: creditTransactionData,
        },
      },
    });
  }

  async updateFiatTransactionStatusToFailed(
    fiatTransaction: FiatTransaction,
    amount: bigint,
    currency: string,
  ): Promise<FiatTransaction> {
    return await this.client.fiatTransaction.update({
      where: { id: fiatTransaction.id },
      data: { status: FiatTransactionStatus.FAILED, amount, currency },
    });
  }
}
