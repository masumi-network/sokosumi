import { AgentStatus, type CreditCost, PricingType } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { buildAvailableAgentWhereClause } from "./agent";

function createCreditCost(unit: string): CreditCost {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: `credit-cost-${unit}`,
    createdAt: now,
    updatedAt: now,
    unit,
    centsPerUnit: BigInt(1),
  };
}

describe("buildAvailableAgentWhereClause", () => {
  it("does not include organization allowlist or denylist filters", () => {
    const where = buildAvailableAgentWhereClause([createCreditCost("USD")]);

    expect(Object.prototype.hasOwnProperty.call(where, "OR")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(where, "NOT")).toBe(false);
    expect(where.status).toBe(AgentStatus.ONLINE);
    expect(where.isShown).toBe(true);
  });

  it("keeps pricing validation behavior unchanged", () => {
    const where = buildAvailableAgentWhereClause([
      createCreditCost("USD"),
      createCreditCost("EUR"),
    ]);

    expect(where.pricing).toEqual({
      pricingType: { not: PricingType.UNKNOWN },
      OR: [
        { pricingType: PricingType.FREE },
        {
          pricingType: PricingType.FIXED,
          fixedPricing: {
            amounts: {
              every: {
                unit: { in: ["USD", "EUR"] },
              },
            },
          },
        },
      ],
    });
  });
});
