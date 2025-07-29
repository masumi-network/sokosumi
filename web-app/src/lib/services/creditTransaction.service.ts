import { CreditTransaction } from "@/prisma/generated/client";

import { BaseService } from "./base.service";

export class CreditTransactionService extends BaseService<CreditTransactionService> {
  async getCentsByUserId(userId: string): Promise<bigint> {
    const centsBalance = await this.client.creditTransaction.aggregate({
      where: { userId, organizationId: null },
      _sum: {
        amount: true,
      },
    });
    return centsBalance._sum.amount ?? BigInt(0);
  }

  async getCentsByOrganizationId(organizationId: string): Promise<bigint> {
    const centsBalance = await this.client.creditTransaction.aggregate({
      where: { organizationId },
      _sum: {
        amount: true,
      },
    });
    return centsBalance._sum.amount ?? BigInt(0);
  }

  async getCreditTransactionByJobId(
    jobId: string,
  ): Promise<CreditTransaction | null> {
    return this.client.creditTransaction.findFirst({
      where: { job: { id: jobId } },
      include: {
        job: true,
      },
    });
  }
}
