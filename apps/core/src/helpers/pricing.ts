import { type CreditCost, PricingType } from "@sokosumi/database";
import {
  convertCentsToCredits,
  convertCreditsToCents,
  feeFromCentsBasedOnPercentagePoints,
} from "@sokosumi/database/helpers";

import { CREDIT } from "@/config/constants";
import { getAuthorFromAgent } from "@/schemas/author.schema";
import type { AgentWithPricing } from "@/types/agent";

/**
 * Transforms an agent with pricing into the response format.
 * @param agent - The agent with pricing.
 * @param creditCosts - The credit costs.
 * @param minFeeCents - The minimum fee cents.
 * @returns The transformed agent with credits, or null if credits calculation fails.
 */
export const transformAgentWithCredits = (
  agent: AgentWithPricing,
  creditCosts: CreditCost[],
) => {
  const minFeeCents = convertCreditsToCents(CREDIT.MIN_FEE_CREDITS);
  const credits = calculateAgentCredits(agent, creditCosts, minFeeCents);

  if (credits === null) {
    return null;
  }

  return {
    ...agent,
    name: agent.overrideName ?? agent.name,
    description: agent.overrideDescription ?? agent.description,
    author: getAuthorFromAgent(agent),
    credits,
  };
};

/**
 * This function calculates the credits for an agent.
 * @param agent - The agent with pricing.
 * @param creditCosts - The credit costs.
 * @param minFeeCents - The minimum fee cents.
 * @returns The credits for the agent or null if the agent has invalid or unknown pricing.
 */
const calculateAgentCredits = (
  agent: AgentWithPricing,
  creditCosts: CreditCost[],
  minFeeCents: bigint,
): number | null => {
  switch (agent.pricing.pricingType) {
    case PricingType.FIXED: {
      if (
        !agent.pricing.fixedPricing ||
        agent.pricing.fixedPricing.amounts.length === 0
      ) {
        return null;
      }
      const pricing = agent.pricing.fixedPricing.amounts.map((amount) => ({
        unit: amount.unit,
        amount: amount.amount,
      }));

      let totalCents = BigInt(0);
      let totalFee = BigInt(0);
      for (const amount of pricing) {
        const creditCost = creditCosts.find(
          (creditCost) => creditCost.unit === amount.unit,
        );
        if (!creditCost) {
          return null;
        }
        const cents = amount.amount * creditCost.centsPerUnit;
        const fee = feeFromCentsBasedOnPercentagePoints(
          cents,
          CREDIT.FEE_PERCENTAGE_POINTS,
        );
        totalCents += cents;
        totalFee += fee;
      }

      if (totalFee < minFeeCents) {
        totalFee = minFeeCents;
      }
      const [totalCentsWithFee, _] = roundUpCentsWithFee(totalCents, totalFee);
      return convertCentsToCredits(totalCentsWithFee);
    }
    case PricingType.FREE: {
      return 0;
    }
    case PricingType.UNKNOWN: {
      return null;
    }
  }
};

/**
 * This function rounds up the total cents to show credits as integer.
 * Adds the difference to the total fee.
 * @param totalCents - The total cents to round up.
 * @param totalFee - The total fee.
 * @returns The rounded total cents with fee and the total fee which also includes difference.
 */
const roundUpCentsWithFee = (
  cents: bigint,
  fee: bigint,
): [cents: bigint, fee: bigint] => {
  const centsWithFee = cents + fee;
  const roundedCentsWithFee = convertCreditsToCents(
    Math.ceil(convertCentsToCredits(centsWithFee)),
  );
  const diff = roundedCentsWithFee - centsWithFee;
  return [roundedCentsWithFee, fee + diff];
};
