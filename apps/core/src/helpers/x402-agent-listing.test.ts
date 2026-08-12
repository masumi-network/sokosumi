import type { CreditCost } from "@sokosumi/database";
import { PricingType } from "@sokosumi/database";
import { describe, expect, it } from "vitest";
import {
  buildX402AgentPaymentSources,
  type X402AgentPaymentSourceRow,
  type X402ListingGateContext,
} from "./x402-agent-listing";
import type { X402ReadySource } from "./x402-readiness";

const BASE_SEPOLIA = "eip155:84532";
const BASE_MAINNET = "eip155:8453";
const USDC_ADDRESS = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const EURC_ADDRESS = "0x808456652fdb597867f38412077a9182bf77359f";
const PAY_TO = "0x1111111111111111111111111111111111111111";
const OTHER_PAY_TO = "0x9999999999999999999999999999999999999999";

const READY_SOURCES: X402ReadySource[] = [
  { caip2Network: BASE_SEPOLIA, asset: USDC_ADDRESS, evmWalletId: "wallet-1" },
  { caip2Network: BASE_SEPOLIA, asset: EURC_ADDRESS, evmWalletId: "wallet-1" },
];

function createCreditCost(
  unit: string,
  centsPerUnit: bigint = 2n * 10n ** 10n, // 2 credits per whole token
): CreditCost {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: `credit-cost-${unit}`,
    createdAt: now,
    updatedAt: now,
    unit,
    centsPerUnit,
  };
}

const PRICED_CREDIT_COSTS = [
  createCreditCost(`${BASE_SEPOLIA}/erc20:${USDC_ADDRESS}`),
  createCreditCost(`${BASE_SEPOLIA}/erc20:${EURC_ADDRESS}`),
];

function createSource(
  overrides: Partial<X402AgentPaymentSourceRow> = {},
): X402AgentPaymentSourceRow {
  return {
    network: BASE_SEPOLIA,
    payTo: PAY_TO,
    pricingType: PricingType.FIXED,
    scheme: "exact",
    amounts: [{ unit: USDC_ADDRESS, amount: 250000n, decimals: 6 }],
    ...overrides,
  };
}

const CONTEXT = {
  creditCosts: PRICED_CREDIT_COSTS,
  readySources: READY_SOURCES,
  network: "Preprod",
} as const;

describe("buildX402AgentPaymentSources", () => {
  it("lists a priced, allowed, buy-side-ready source with converted credits", () => {
    const result = buildX402AgentPaymentSources([createSource()], CONTEXT);

    // ceil(250000 * 2e10 / 1e6) = 5e9 cents = 0.5 credits.
    expect(result).toEqual([
      {
        caip2Network: BASE_SEPOLIA,
        asset: USDC_ADDRESS,
        decimals: 6,
        payTo: PAY_TO,
        amount: "250000",
        credits: 0.5,
      },
    ]);
  });

  it("canonicalizes mixed-case registry network and asset spellings", () => {
    const result = buildX402AgentPaymentSources(
      [
        createSource({
          network: " EIP155:84532 ",
          amounts: [
            { unit: USDC_ADDRESS.toUpperCase(), amount: 250000n, decimals: 6 },
          ],
        }),
      ],
      CONTEXT,
    );

    expect(result).toEqual([
      expect.objectContaining({
        caip2Network: BASE_SEPOLIA,
        asset: USDC_ADDRESS,
      }),
    ]);
  });

  it("drops an agent with no advertised payment source", () => {
    expect(buildX402AgentPaymentSources([], CONTEXT)).toBeNull();
  });

  it.each([
    ["FREE", PricingType.FREE],
    ["UNKNOWN", PricingType.UNKNOWN],
  ])("drops an agent advertising a %s-priced source", (_label, pricingType) => {
    expect(
      buildX402AgentPaymentSources([createSource({ pricingType })], CONTEXT),
    ).toBeNull();
  });

  it.each([
    ["a non-exact scheme", "upto"],
    ["an unrecorded scheme", null],
    ["an empty scheme", "  "],
  ])("drops an agent whose source advertises %s", (_label, scheme) => {
    // `scheme` decides what the payer signs. Only x402 `exact` is understood
    // here, and an unrecorded one is unknown, not assumed.
    expect(
      buildX402AgentPaymentSources([createSource({ scheme })], CONTEXT),
    ).toBeNull();
  });

  it("accepts the exact scheme in any registry spelling", () => {
    const result = buildX402AgentPaymentSources(
      [createSource({ scheme: " Exact " })],
      CONTEXT,
    );

    expect(result).toHaveLength(1);
  });

  it("drops an agent whose source has no payTo", () => {
    expect(
      buildX402AgentPaymentSources([createSource({ payTo: null })], CONTEXT),
    ).toBeNull();
  });

  it("drops an agent advertising a network outside the per-env allowlist", () => {
    // Base mainnet is not payable on Preprod even when priced and ready.
    const mainnetContext: X402ListingGateContext = {
      creditCosts: [createCreditCost(`${BASE_MAINNET}/erc20:${USDC_ADDRESS}`)],
      readySources: [
        {
          caip2Network: BASE_MAINNET,
          asset: USDC_ADDRESS,
          evmWalletId: "wallet-1",
        },
      ],
      network: "Preprod",
    };

    expect(
      buildX402AgentPaymentSources(
        [createSource({ network: BASE_MAINNET })],
        mainnetContext,
      ),
    ).toBeNull();
  });

  it("drops an agent whose FIXED source has no amount rows", () => {
    expect(
      buildX402AgentPaymentSources([createSource({ amounts: [] })], CONTEXT),
    ).toBeNull();
  });

  it("drops an agent whose amount row has no recorded decimals", () => {
    expect(
      buildX402AgentPaymentSources(
        [
          createSource({
            amounts: [{ unit: USDC_ADDRESS, amount: 250000n, decimals: null }],
          }),
        ],
        CONTEXT,
      ),
    ).toBeNull();
  });

  it("drops an agent whose (network, asset) pair is not buy-side ready", () => {
    expect(
      buildX402AgentPaymentSources([createSource()], {
        ...CONTEXT,
        readySources: [
          {
            caip2Network: BASE_SEPOLIA,
            asset: "0x2222222222222222222222222222222222222222",
            evmWalletId: "wallet-1",
          },
        ],
      }),
    ).toBeNull();
  });

  it("drops an agent whose asset has no CreditCost row", () => {
    expect(
      buildX402AgentPaymentSources([createSource()], {
        ...CONTEXT,
        creditCosts: [createCreditCost("lovelace")],
      }),
    ).toBeNull();
  });

  it("drops an agent whose CreditCost row is not positive", () => {
    expect(
      buildX402AgentPaymentSources([createSource()], {
        ...CONTEXT,
        creditCosts: [
          createCreditCost(`${BASE_SEPOLIA}/erc20:${USDC_ADDRESS}`, 0n),
        ],
      }),
    ).toBeNull();
  });

  it("lists each distinct asset a single source prices", () => {
    // Dedupe keys on (payTo, network, asset) — two DIFFERENT assets under one
    // source are two genuine advertised entries, not duplicates.
    const result = buildX402AgentPaymentSources(
      [
        createSource({
          amounts: [
            { unit: USDC_ADDRESS, amount: 250000n, decimals: 6 },
            { unit: EURC_ADDRESS, amount: 500000n, decimals: 6 },
          ],
        }),
      ],
      CONTEXT,
    );

    expect(result).toEqual([
      expect.objectContaining({ asset: USDC_ADDRESS, amount: "250000" }),
      expect.objectContaining({ asset: EURC_ADDRESS, amount: "500000" }),
    ]);
  });

  it("collapses an identical duplicate amount row into one advertised entry", () => {
    // Ingestion permits duplicate units within one source's fixed amounts. Two
    // rows saying the same thing are one advertised price, and the pay side's
    // first-match resolution agrees with either row.
    const result = buildX402AgentPaymentSources(
      [
        createSource({
          amounts: [
            { unit: USDC_ADDRESS, amount: 250000n, decimals: 6 },
            { unit: USDC_ADDRESS, amount: 250000n, decimals: 6 },
          ],
        }),
      ],
      CONTEXT,
    );

    expect(result).toEqual([
      {
        caip2Network: BASE_SEPOLIA,
        asset: USDC_ADDRESS,
        decimals: 6,
        payTo: PAY_TO,
        amount: "250000",
        credits: 0.5,
      },
    ]);
  });

  it("drops an agent whose source prices one asset at two different amounts", () => {
    // The pay side resolves (payTo, network, asset) to exactly ONE amount row
    // by first match in unordered heap order. Advertising both 0.5 and 10
    // credits for the same triple makes listed ⇒ payable a coin flip, so the
    // conflict hides the agent instead.
    expect(
      buildX402AgentPaymentSources(
        [
          createSource({
            amounts: [
              { unit: USDC_ADDRESS, amount: 250000n, decimals: 6 },
              { unit: USDC_ADDRESS, amount: 5000000n, decimals: 6 },
            ],
          }),
        ],
        CONTEXT,
      ),
    ).toBeNull();
  });

  it("drops an agent whose duplicate amount rows disagree on decimals", () => {
    // Same base-unit amount, different decimals — a different price per whole
    // token, so the two rows are not interchangeable.
    expect(
      buildX402AgentPaymentSources(
        [
          createSource({
            amounts: [
              { unit: USDC_ADDRESS, amount: 250000n, decimals: 6 },
              { unit: USDC_ADDRESS, amount: 250000n, decimals: 8 },
            ],
          }),
        ],
        CONTEXT,
      ),
    ).toBeNull();
  });

  it("drops an agent whose two sources price the same triple differently", () => {
    // Dedupe spans the agent, not one source: the pay side scans sources in
    // order and stops at the first with a matching asset, so a conflicting
    // second source is the same coin flip.
    expect(
      buildX402AgentPaymentSources(
        [
          createSource(),
          createSource({
            amounts: [{ unit: USDC_ADDRESS, amount: 5000000n, decimals: 6 }],
          }),
        ],
        CONTEXT,
      ),
    ).toBeNull();
  });

  it("keeps the same asset priced under two different payTo recipients", () => {
    // Different recipients are different triples — each is independently
    // payable, so neither collapses nor conflicts.
    const result = buildX402AgentPaymentSources(
      [
        createSource(),
        createSource({
          payTo: OTHER_PAY_TO,
          amounts: [{ unit: USDC_ADDRESS, amount: 5000000n, decimals: 6 }],
        }),
      ],
      CONTEXT,
    );

    expect(result).toEqual([
      expect.objectContaining({ payTo: PAY_TO, amount: "250000" }),
      expect.objectContaining({ payTo: OTHER_PAY_TO, amount: "5000000" }),
    ]);
  });

  it("drops the whole agent when one of several sources fails a gate", () => {
    // The agent picks which source its 402 demands, so one unpayable source
    // poisons the per-agent listed ⇒ payable promise.
    expect(
      buildX402AgentPaymentSources(
        [createSource(), createSource({ payTo: null })],
        CONTEXT,
      ),
    ).toBeNull();
  });
});
