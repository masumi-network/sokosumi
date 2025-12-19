import { createRoute } from "@hono/zod-openapi";
import { AgentStatus, type CreditCost, PricingType } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";
import {
  convertCentsToCredits,
  convertCreditsToCents,
  feeFromCentsBasedOnPercentagePoints,
} from "@sokosumi/database/helpers";

import { CREDIT } from "@/config/constants";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { agentsSchema } from "@/schemas/agent.schema";
import { getDeveloperFromAgent } from "@/schemas/developer.schema";
import {
  agentOrderBy,
  agentPricingInclude,
  type AgentWithPricing,
} from "@/types/agent";

const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Agents"],
  responses: {
    200: jsonSuccessResponse(agentsSchema, "Retrieve all agents"),
    401: jsonErrorResponse("Unauthorized"),
  },
});

export function getAgentCredits(
  agent: AgentWithPricing,
  creditCosts: CreditCost[],
  minFeeCents: bigint,
): number | null {
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
}

/**
 * This function rounds up the total cents to show credits as integer.
 * Adds the difference to the total fee.
 * @param totalCents - The total cents to round up.
 * @param totalFee - The total fee.
 * @returns The rounded total cents with fee and the total fee which also includes difference.
 */
const roundUpCentsWithFee = (cents: bigint, fee: bigint): [bigint, bigint] => {
  const centsWithFee = cents + fee;
  const roundedCentsWithFee = convertCreditsToCents(
    Math.ceil(convertCentsToCredits(centsWithFee)),
  );
  const diff = roundedCentsWithFee - centsWithFee;
  return [roundedCentsWithFee, fee + diff];
};

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const agents = await prisma.$transaction(async (tx) => {
      const agents = await tx.agent.findMany({
        include: { ...agentPricingInclude },
        orderBy: [...agentOrderBy],
        where: {
          status: AgentStatus.ONLINE,
          isShown: true,
        },
      });

      const creditCosts = await tx.creditCost.findMany();
      const minFeeCents = convertCreditsToCents(CREDIT.MIN_FEE_CREDITS);

      return agents
        .map((agent) => {
          const credits = getAgentCredits(agent, creditCosts, minFeeCents);
          if (credits === null) {
            return null;
          }
          return {
            ...agent,
            name: agent.overrideName ?? agent.name,
            description: agent.overrideDescription ?? agent.description,
            developer: getDeveloperFromAgent(agent),
            credits: credits ?? 0,
          };
        })
        .filter((agent) => agent !== null);
    });
    return ok(c, agentsSchema.parse(agents));
  });
}
