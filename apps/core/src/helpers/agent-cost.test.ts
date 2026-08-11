import type { AgentWithPricing, CreditCost } from "@sokosumi/database";
import { PricingType } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  calculateCentsFromMasumiAmountStrings,
  getAgentCost,
  listCardanoBillableUnitSpellings,
} from "./agent-cost";

const CAIP19_USDC_BASE_SEPOLIA =
  "eip155:84532/erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e";

function createCreditCost(unit: string, centsPerUnit = 1n): CreditCost {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: `credit-cost-${unit}`,
    createdAt: now,
    updatedAt: now,
    unit,
    centsPerUnit,
  };
}

const sampleCreditCosts: CreditCost[] = [createCreditCost("lovelace")];

describe("calculateCentsFromMasumiAmountStrings", () => {
  it("rejects invalid amount strings", () => {
    expect(() =>
      calculateCentsFromMasumiAmountStrings(
        [{ amount: "not-a-number", unit: "lovelace" }],
        sampleCreditCosts,
      ),
    ).toThrow();
  });

  it("rejects non-positive amounts", () => {
    expect(() =>
      calculateCentsFromMasumiAmountStrings(
        [{ amount: "0", unit: "lovelace" }],
        sampleCreditCosts,
      ),
    ).toThrow();
  });

  it("treats the registry's empty ADA asset as lovelace", () => {
    expect(
      calculateCentsFromMasumiAmountStrings(
        [{ amount: "2000000", unit: "" }],
        sampleCreditCosts,
      ),
    ).toBe(2000000n);
  });

  it("rejects a CAIP-19 unit — wrong pricing convention path", () => {
    // CAIP-19 CreditCost rows price per WHOLE token; this reader multiplies
    // per SMALLEST unit. Honoring the row would charge 10^decimals× wrong,
    // so the unit is unprocessable here even when a priced row exists.
    expect(() =>
      calculateCentsFromMasumiAmountStrings(
        [{ amount: "1000000", unit: CAIP19_USDC_BASE_SEPOLIA }],
        [...sampleCreditCosts, createCreditCost(CAIP19_USDC_BASE_SEPOLIA)],
      ),
    ).toThrowError(/CAIP-19 asset key/);

    // Case-insensitive: normalizeMasumiPaymentUnit lowercases, and CAIP-19
    // detection must survive a shouty spelling.
    expect(() =>
      calculateCentsFromMasumiAmountStrings(
        [{ amount: "1", unit: CAIP19_USDC_BASE_SEPOLIA.toUpperCase() }],
        sampleCreditCosts,
      ),
    ).toThrowError(/CAIP-19 asset key/);
  });
});

describe("getAgentCost", () => {
  function fixedPricedAgent(unit: string): AgentWithPricing {
    return {
      pricing: {
        pricingType: PricingType.FIXED,
        fixedPricing: {
          amounts: [{ unit, amount: 1000000n }],
        },
      },
    } as AgentWithPricing;
  }

  it("prices a Cardano-convention fixed row per smallest unit", () => {
    expect(
      getAgentCost(fixedPricedAgent("lovelace"), sampleCreditCosts),
    ).toEqual({ cents: 1000000n });
  });

  it("rejects a fixed pricing row spelling a CAIP-19 unit", () => {
    expect(() =>
      getAgentCost(fixedPricedAgent(CAIP19_USDC_BASE_SEPOLIA), [
        ...sampleCreditCosts,
        createCreditCost(CAIP19_USDC_BASE_SEPOLIA),
      ]),
    ).toThrowError(/CAIP-19 asset key/);
  });
});

describe("listCardanoBillableUnitSpellings", () => {
  it("carries both spellings and the ADA aliases", () => {
    expect(
      listCardanoBillableUnitSpellings([
        createCreditCost("LOVELACE"),
        createCreditCost("USDM"),
      ]),
    ).toEqual(["LOVELACE", "lovelace", "", "USDM", "usdm"]);
  });

  it("excludes CAIP-19 units in either casing", () => {
    // A CAIP-19 row must never make a Cardano-convention agent billable:
    // its price is per whole token, the Cardano readers bill per smallest
    // unit.
    expect(
      listCardanoBillableUnitSpellings([
        createCreditCost(CAIP19_USDC_BASE_SEPOLIA),
        createCreditCost(CAIP19_USDC_BASE_SEPOLIA.toUpperCase()),
        createCreditCost("lovelace"),
      ]),
    ).toEqual(["lovelace", ""]);
  });
});
