import "server-only";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import { convertCreditsToCents } from "@/lib/db/helpers/credit";
import { CreditsPrice } from "@/lib/db/types";
import {
  pricingAmountsSchema,
  PricingAmountsSchemaType,
} from "@/lib/schemas/credit";

import { BaseService } from "./base.service";

export class CreditCostService extends BaseService<CreditCostService> {
  async getCreditsPrice(
    amounts: PricingAmountsSchemaType,
  ): Promise<CreditsPrice> {
    const feePercentagePoints = getEnvPublicConfig().NEXT_PUBLIC_FEE_PERCENTAGE;
    if (feePercentagePoints < 0) {
      throw new Error(
        "Added fee percentage must be equal to or greater than 0",
      );
    }
    const feeMultiplier = feePercentagePoints / 100;
    const amountsParsed = pricingAmountsSchema.parse(amounts);

    let totalCents = BigInt(0);
    let totalFee = BigInt(0);
    const minFeeCents = convertCreditsToCents(getEnvSecrets().MIN_FEE_CREDITS);
    for (const amount of amountsParsed) {
      const creditCost = await this.client.creditCost.findUnique({
        where: { unit: amount.unit },
      });
      if (!creditCost) {
        throw new Error(`Credit cost not found for unit ${amount.unit}`);
      }
      const cents = amount.amount * Number(creditCost.centsPerUnit);
      const fee = cents * feeMultiplier;

      // round up to the nearest integer
      totalCents += BigInt(Math.ceil(cents));
      totalFee += BigInt(Math.ceil(fee));
    }
    if (totalFee < minFeeCents) {
      totalFee = minFeeCents;
    }
    return { cents: totalCents + totalFee, includedFee: totalFee };
  }
}
