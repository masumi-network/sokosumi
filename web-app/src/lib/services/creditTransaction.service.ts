import "server-only";

import { convertCentsToCredits } from "@/lib/db/helpers/credit";
import { CreditTransaction } from "@/prisma/generated/client";

import { BaseService } from "./base.service";

export class CreditTransactionService extends BaseService<CreditTransactionService> {
  async getUserCredits(userId: string): Promise<number> {
    const centsBalance = await this.getCentsByUserId(userId);
    return convertCentsToCredits(centsBalance);
  }

  async getCentsByUserId(userId: string): Promise<bigint> {
    const centsBalance = await this.client.creditTransaction.aggregate({
      where: { userId, organizationId: null },
      _sum: {
        amount: true,
      },
    });
    return centsBalance._sum.amount ?? BigInt(0);
  }

  async getOrganizationCredits(organizationId: string): Promise<number> {
    const centsBalance = await this.getCentsByOrganizationId(organizationId);
    return convertCentsToCredits(centsBalance);
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
