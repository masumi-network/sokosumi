import type { CreditCost } from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";

import { LIMITS } from "@/config/constants";

import { calculateCentsFromX402Amount } from "./x402-pricing";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_BASE_KEY = `eip155:8453/erc20:${USDC_BASE.toLowerCase()}`;

function creditCostRow(overrides: Partial<CreditCost> = {}): CreditCost {
  return {
    id: "credit-cost-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    unit: USDC_BASE_KEY,
    // 1 whole USDC = 1 credit = 10^10 cents.
    centsPerUnit: 10_000_000_000n,
    ...overrides,
  };
}

function expect422(run: () => void, messagePattern: RegExp): void {
  try {
    run();
    expect.unreachable("expected a 422 HTTPException");
  } catch (error) {
    expect(error).toBeInstanceOf(HTTPException);
    expect((error as HTTPException).status).toBe(422);
    expect((error as HTTPException).message).toMatch(messagePattern);
  }
}

describe("calculateCentsFromX402Amount", () => {
  it("converts a whole-token amount exactly", () => {
    // 2.5 USDC at 1 credit per USDC → 2.5 credits → 2.5e10 cents.
    const cents = calculateCentsFromX402Amount(
      {
        caip2Network: "eip155:8453",
        asset: USDC_BASE,
        amount: "2500000",
        decimals: 6,
      },
      [creditCostRow()],
    );
    expect(cents).toBe(25_000_000_000n);
  });

  it("ceils partial base-unit conversions instead of truncating", () => {
    // 1 base unit at 3 cents per whole token: 3/10^6 cents = 0.000003 → ceil 1.
    const dustCents = calculateCentsFromX402Amount(
      {
        caip2Network: "eip155:8453",
        asset: USDC_BASE,
        amount: "1",
        decimals: 6,
        // Deliberately tiny per-token price so the exact quotient is < 1.
      },
      [creditCostRow({ centsPerUnit: 3n })],
    );
    expect(dustCents).toBe(1n);

    // 3 base units at 5 cents per 10-base-unit token: exact quotient 1.5.
    // Distinguishes ceiling from floor division ABOVE the charge floor, where
    // the floor cannot mask a truncation bug.
    const midCents = calculateCentsFromX402Amount(
      {
        caip2Network: "eip155:8453",
        asset: USDC_BASE,
        amount: "3",
        decimals: 1,
      },
      [creditCostRow({ centsPerUnit: 5n })],
    );
    expect(midCents).toBe(2n);
  });

  it("never charges below MIN_CHARGEABLE_CREDITS (charge floor)", () => {
    const minCents = convertCreditsToCents(LIMITS.MIN_CHARGEABLE_CREDITS);
    // Dust: 1 base unit of a 6-decimals asset priced at 100 cents per token
    // is 100/10^6 = 0.0001 cents exact → ceil 1n → already ≥ floor; use an
    // 18-decimals asset so the exact quotient is far below one cent.
    const cents = calculateCentsFromX402Amount(
      {
        caip2Network: "eip155:8453",
        asset: USDC_BASE,
        amount: "1",
        decimals: 18,
      },
      [creditCostRow({ centsPerUnit: 100n })],
    );
    expect(cents).toBe(minCents);
    expect(cents).toBeGreaterThanOrEqual(1n);
  });

  it("lifts a sub-floor conversion up to a raised MIN_CHARGEABLE_CREDITS", async () => {
    // With today's constant (1e-10 credits = 1 cent) the ceiling already
    // guarantees the floor, so the floor branch is only observable with a
    // raised minimum. Isolate the module with a mocked constant to pin the
    // branch itself — a dropped `max` must fail HERE even though every other
    // test still passes.
    vi.resetModules();
    vi.doMock("@/config/constants", () => ({
      LIMITS: { MIN_CHARGEABLE_CREDITS: 5 },
    }));
    try {
      const { calculateCentsFromX402Amount: calculateWithRaisedFloor } =
        await import("./x402-pricing");
      const cents = calculateWithRaisedFloor(
        {
          caip2Network: "eip155:8453",
          asset: USDC_BASE,
          // 1 whole token = 1 credit = 1e10 cents — below the 5-credit floor.
          amount: "1000000",
          decimals: 6,
        },
        [creditCostRow()],
      );
      expect(cents).toBe(convertCreditsToCents(5));
    } finally {
      vi.doUnmock("@/config/constants");
      vi.resetModules();
    }
  });

  it("matches the credit-cost row case-insensitively", () => {
    const cents = calculateCentsFromX402Amount(
      {
        caip2Network: "EIP155:8453",
        asset: USDC_BASE.toUpperCase().replace("0X", "0x"),
        amount: "1000000",
        decimals: 6,
      },
      [creditCostRow({ unit: USDC_BASE_KEY.toUpperCase() })],
    );
    expect(cents).toBe(10_000_000_000n);
  });

  it("fails closed when the asset has no credit-cost row", () => {
    expect422(
      () =>
        calculateCentsFromX402Amount(
          {
            caip2Network: "eip155:84532",
            asset: USDC_BASE,
            amount: "1000000",
            decimals: 6,
          },
          // Priced on mainnet only — the testnet demand must not match.
          [creditCostRow()],
        ),
      /Credit cost not found for unit eip155:84532/,
    );
  });

  it("rejects a non-positive credit-cost row as unpriced", () => {
    expect422(
      () =>
        calculateCentsFromX402Amount(
          {
            caip2Network: "eip155:8453",
            asset: USDC_BASE,
            amount: "1000000",
            decimals: 6,
          },
          [creditCostRow({ centsPerUnit: 0n })],
        ),
      /is not positive/,
    );
  });

  it("rejects malformed, zero, and negative amounts", () => {
    for (const amount of ["", "abc", "1.5", "-1", "0x10"]) {
      expect422(
        () =>
          calculateCentsFromX402Amount(
            {
              caip2Network: "eip155:8453",
              asset: USDC_BASE,
              amount,
              decimals: 6,
            },
            [creditCostRow()],
          ),
        /Invalid x402 amount/,
      );
    }
    expect422(
      () =>
        calculateCentsFromX402Amount(
          {
            caip2Network: "eip155:8453",
            asset: USDC_BASE,
            amount: "0",
            decimals: 6,
          },
          [creditCostRow()],
        ),
      /must be positive/,
    );
  });

  it("rejects out-of-range decimals", () => {
    for (const decimals of [-1, 1.5, 256, Number.NaN]) {
      expect422(
        () =>
          calculateCentsFromX402Amount(
            {
              caip2Network: "eip155:8453",
              asset: USDC_BASE,
              amount: "1000000",
              decimals,
            },
            [creditCostRow()],
          ),
        /Invalid asset decimals/,
      );
    }
  });

  it("rejects an unbuildable asset identity as a 422, not a 500", () => {
    expect422(
      () =>
        calculateCentsFromX402Amount(
          {
            caip2Network: "base",
            asset: USDC_BASE,
            amount: "1000000",
            decimals: 6,
          },
          [creditCostRow()],
        ),
      /Invalid CAIP-2 EVM network/,
    );
    expect422(
      () =>
        calculateCentsFromX402Amount(
          {
            caip2Network: "eip155:8453",
            asset: "USDC",
            amount: "1000000",
            decimals: 6,
          },
          [creditCostRow()],
        ),
      /Invalid ERC-20 asset address/,
    );
  });

  it("handles zero decimals (whole-token base units)", () => {
    const cents = calculateCentsFromX402Amount(
      {
        caip2Network: "eip155:8453",
        asset: USDC_BASE,
        amount: "3",
        decimals: 0,
      },
      [creditCostRow({ centsPerUnit: 7n })],
    );
    expect(cents).toBe(21n);
  });
});
