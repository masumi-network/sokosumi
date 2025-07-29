import "server-only";

import { CreditCost } from "@/prisma/generated/client";

import { BaseService } from "./base.service";

export class CreditCostService extends BaseService<CreditCostService> {
  async getCreditCostByUnit(unit: string): Promise<CreditCost | null> {
    return this.client.creditCost.findUnique({
      where: { unit },
    });
  }
  async getCreditCosts(): Promise<CreditCost[]> {
    return await this.client.creditCost.findMany();
  }
}
