import type { CreditCost } from "@sokosumi/database";
import { PricingType } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureExceptionMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

import { internalServerError, unprocessableEntity } from "./error";
import {
  buildX402AgentPaymentSources,
  buildX402AgentPricingListing,
  buildX402DynamicAgentPaymentSources,
  reportX402PricingMisconfiguration,
  resetX402PricingMisconfigurationReports,
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
const EVM_WALLET_ADDRESS = "0x52e29e0d2aa49bfbfc548c0a9f2196f4aa51f3ea";

/**
 * The node's published scale for both test assets. Fixtures register the same
 * number, so a test that means to exercise the registry/node split says so by
 * passing a DIFFERENT registry `decimals`.
 */
const NODE_DECIMALS = 6;

const READY_SOURCES: X402ReadySource[] = [
  {
    caip2Network: BASE_SEPOLIA,
    asset: USDC_ADDRESS,
    evmWalletId: "wallet-1",
    evmWalletAddress: EVM_WALLET_ADDRESS,
    decimals: NODE_DECIMALS,
  },
  {
    caip2Network: BASE_SEPOLIA,
    asset: EURC_ADDRESS,
    evmWalletId: "wallet-1",
    evmWalletAddress: EVM_WALLET_ADDRESS,
    decimals: NODE_DECIMALS,
  },
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

beforeEach(() => {
  captureExceptionMock.mockClear();
  resetX402PricingMisconfigurationReports();
});

describe("buildX402AgentPaymentSources", () => {
  it("lists a priced, allowed, buy-side-ready source with converted credits", () => {
    const result = buildX402AgentPaymentSources([createSource()], CONTEXT);

    // ceil(250000 * 2e10 / 1e6) = 5e9 cents = 0.5 credits.
    expect(result).toEqual({
      status: "listed",
      paymentSources: [
        {
          caip2Network: BASE_SEPOLIA,
          asset: USDC_ADDRESS,
          decimals: 6,
          payTo: PAY_TO,
          amount: "250000",
          credits: 0.5,
        },
      ],
    });
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

    expect(result).toEqual({
      status: "listed",
      paymentSources: [
        expect.objectContaining({
          caip2Network: BASE_SEPOLIA,
          asset: USDC_ADDRESS,
        }),
      ],
    });
  });

  it("drops an agent with no advertised payment source", () => {
    expect(buildX402AgentPaymentSources([], CONTEXT)).toEqual({
      status: "dropped",
      reason: "no_payment_source",
    });
  });

  it.each([
    ["FREE", PricingType.FREE],
    ["DYNAMIC", PricingType.DYNAMIC],
    ["UNKNOWN", PricingType.UNKNOWN],
  ])("drops an agent advertising a %s-priced source", (_label, pricingType) => {
    expect(
      buildX402AgentPaymentSources([createSource({ pricingType })], CONTEXT),
    ).toEqual({
      status: "dropped",
      reason: "pricing_not_fixed",
    });
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
    ).toEqual({
      status: "dropped",
      reason: "unsupported_scheme",
    });
  });

  it("accepts the exact scheme in any registry spelling", () => {
    const result = buildX402AgentPaymentSources(
      [createSource({ scheme: " Exact " })],
      CONTEXT,
    );

    expect(result).toEqual({
      status: "listed",
      paymentSources: [expect.objectContaining({ asset: USDC_ADDRESS })],
    });
  });

  it("drops an agent whose source has no payTo", () => {
    expect(
      buildX402AgentPaymentSources([createSource({ payTo: null })], CONTEXT),
    ).toEqual({
      status: "dropped",
      reason: "missing_pay_to",
    });
  });

  it("drops an agent whose payTo is whitespace only", () => {
    // A recipient made of spaces records no recipient.
    expect(
      buildX402AgentPaymentSources([createSource({ payTo: "   " })], CONTEXT),
    ).toEqual({
      status: "dropped",
      reason: "missing_pay_to",
    });
  });

  it.each([
    ["a non-address string", "not-an-address"],
    ["a truncated address", "0x1111"],
    ["an over-long address", `${PAY_TO}00`],
    ["a non-hex address", "0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"],
    ["a bare hex string with no 0x", PAY_TO.slice(2)],
  ])("drops an agent whose source records %s as payTo", (_label, payTo) => {
    // The pay side's payTo comes from an EVM_ADDRESS_PATTERN-validated 402, so
    // a recipient that is not an EVM address can never be matched — listing it
    // advertises a 402 the pay endpoint is guaranteed to reject.
    expect(
      buildX402AgentPaymentSources([createSource({ payTo })], CONTEXT),
    ).toEqual({
      status: "dropped",
      reason: "malformed_pay_to",
    });
  });

  it("accepts a mixed-case checksummed payTo in its registry spelling", () => {
    // EVM_ADDRESS_PATTERN accepts mixed case, and the advertised value keeps
    // the registry's checksummed spelling; only the dedupe key case-folds.
    const checksummed = `0x${"aAbB".repeat(10)}`;

    const result = buildX402AgentPaymentSources(
      [createSource({ payTo: checksummed })],
      CONTEXT,
    );

    expect(result).toEqual({
      status: "listed",
      paymentSources: [expect.objectContaining({ payTo: checksummed })],
    });
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
          evmWalletAddress: EVM_WALLET_ADDRESS,
          decimals: NODE_DECIMALS,
        },
      ],
      network: "Preprod",
    };

    expect(
      buildX402AgentPaymentSources(
        [createSource({ network: BASE_MAINNET })],
        mainnetContext,
      ),
    ).toEqual({
      status: "dropped",
      reason: "network_not_allowed",
    });
  });

  it("drops an agent whose FIXED source has no amount rows", () => {
    expect(
      buildX402AgentPaymentSources([createSource({ amounts: [] })], CONTEXT),
    ).toEqual({
      status: "dropped",
      reason: "no_amount_rows",
    });
  });

  it("drops an agent when only ONE of its sources has no amount rows", () => {
    // The single-source case above cannot tell the per-source gate apart from
    // the tail guard, which reports the same reason for an empty result. Only
    // a second, payable source separates them: without the per-source gate the
    // empty source is skipped, the agent is LISTED off source 1, and the
    // per-agent fail-closed promise has quietly degraded to per-source skip —
    // the agent's own 402 may still demand payment on the source Soko never
    // verified.
    expect(
      buildX402AgentPaymentSources(
        [
          createSource({ amounts: [] }),
          createSource({
            amounts: [{ unit: EURC_ADDRESS, amount: 500000n, decimals: 6 }],
          }),
        ],
        CONTEXT,
      ),
    ).toEqual({
      status: "dropped",
      reason: "no_amount_rows",
    });
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
    ).toEqual({
      status: "dropped",
      reason: "missing_decimals",
    });
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
            evmWalletAddress: EVM_WALLET_ADDRESS,
            decimals: NODE_DECIMALS,
          },
        ],
      }),
    ).toEqual({
      status: "dropped",
      reason: "not_buy_side_ready",
    });
  });

  it("prices off the node's decimals when the registry's disagree", () => {
    // `decimals` divides the charge, so it is the one field an agent must not
    // be able to author: registering 18 for a 6-decimals USDC prices a real
    // dollar at MIN_CHARGEABLE_CREDITS while Soko's managed wallet signs the
    // full demand away, and the ceiling check cannot catch it because it
    // compares against the same agent-registered amount. The node's published
    // scale is the only authoritative copy Soko has.
    const result = buildX402AgentPaymentSources(
      [
        createSource({
          amounts: [{ unit: USDC_ADDRESS, amount: 250000n, decimals: 18 }],
        }),
      ],
      CONTEXT,
    );

    // ceil(250000 * 2e10 / 1e6) = 5e9 cents = 0.5 credits. Priced off the
    // registry's 18 this would floor at 1 cent (1e-10 credits) and advertise
    // decimals: 18.
    expect(result).toEqual({
      status: "listed",
      paymentSources: [
        {
          caip2Network: BASE_SEPOLIA,
          asset: USDC_ADDRESS,
          decimals: NODE_DECIMALS,
          payTo: PAY_TO,
          amount: "250000",
          credits: 0.5,
        },
      ],
    });
  });

  it("advertises a node scale the registry never mentions", () => {
    // Same split from the other side: the advertised scale tracks the ready
    // pair, so a node value the fixtures never register still reaches both the
    // charge and the response.
    const result = buildX402AgentPaymentSources([createSource()], {
      ...CONTEXT,
      readySources: [
        {
          caip2Network: BASE_SEPOLIA,
          asset: USDC_ADDRESS,
          evmWalletId: "wallet-1",
          evmWalletAddress: EVM_WALLET_ADDRESS,
          decimals: 2,
        },
      ],
    });

    // ceil(250000 * 2e10 / 1e2) = 5e13 cents = 5000 credits.
    expect(result).toEqual({
      status: "listed",
      paymentSources: [
        {
          caip2Network: BASE_SEPOLIA,
          asset: USDC_ADDRESS,
          decimals: 2,
          payTo: PAY_TO,
          amount: "250000",
          credits: 5000,
        },
      ],
    });
  });

  it("drops an agent whose asset has no CreditCost row", () => {
    expect(
      buildX402AgentPaymentSources([createSource()], {
        ...CONTEXT,
        creditCosts: [createCreditCost("lovelace")],
      }),
    ).toEqual({
      status: "dropped",
      reason: "unpriced_asset",
    });
  });

  it("drops an agent whose CreditCost row is not positive", () => {
    expect(
      buildX402AgentPaymentSources([createSource()], {
        ...CONTEXT,
        creditCosts: [
          createCreditCost(`${BASE_SEPOLIA}/erc20:${USDC_ADDRESS}`, 0n),
        ],
      }),
    ).toEqual({
      status: "dropped",
      reason: "unpriced_asset",
    });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("drops duplicate CreditCost rows as pricing_misconfigured and reports to Sentry", () => {
    // `CreditCost.unit` is unique on the RAW string, so a case or whitespace
    // variant coexists with the canonical row and both normalize to one unit.
    // For a fixed agent the pay path re-runs this very gate, so this catch is
    // the operator's ONLY loud surface — it must page, and it must not be
    // tallied as `unpriced_asset` (adding another price row makes it worse).
    expect(
      buildX402AgentPaymentSources([createSource()], {
        ...CONTEXT,
        creditCosts: [
          createCreditCost(`${BASE_SEPOLIA}/erc20:${USDC_ADDRESS}`),
          createCreditCost(
            ` ${BASE_SEPOLIA}/erc20:${USDC_ADDRESS.toUpperCase()} `,
          ),
        ],
      }),
    ).toEqual({
      status: "dropped",
      reason: "pricing_misconfigured",
    });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("classifies a non-HTTPException throw from the pricing helper as pricing_misconfigured AT THE BUILDER", () => {
    // Pins the builder's catch, not just the exported classifier: a re-guard
    // like `error instanceof HTTPException && report(...)` would fold
    // TypeErrors back into unpriced_asset while every classifier unit test
    // stayed green. The getter throws inside calculateCentsFromX402Amount's
    // CreditCost scan, which runs inside the builder's try.
    const poisonedCreditCost: CreditCost = {
      ...createCreditCost(`${BASE_SEPOLIA}/erc20:${USDC_ADDRESS}`),
      get unit(): string {
        throw new TypeError("credit cost row exploded");
      },
    };
    expect(
      buildX402AgentPaymentSources([createSource()], {
        ...CONTEXT,
        creditCosts: [poisonedCreditCost],
      }),
    ).toEqual({
      status: "dropped",
      reason: "pricing_misconfigured",
    });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("reports a lingering misconfiguration to Sentry once per process, not once per request", () => {
    // The gate runs on every listing GET and every pay attempt, and the
    // misconfiguration by definition lingers until an operator acts — so an
    // unthrottled capture would let any authenticated caller loop the
    // endpoint into per-request Sentry volume. The drop reason must still be
    // reported on every call; only the capture is deduped.
    const context = {
      ...CONTEXT,
      creditCosts: [
        createCreditCost(`${BASE_SEPOLIA}/erc20:${USDC_ADDRESS}`),
        createCreditCost(
          ` ${BASE_SEPOLIA}/erc20:${USDC_ADDRESS.toUpperCase()} `,
        ),
      ],
    };
    for (let request = 0; request < 3; request += 1) {
      expect(buildX402AgentPaymentSources([createSource()], context)).toEqual({
        status: "dropped",
        reason: "pricing_misconfigured",
      });
    }
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
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

    expect(result).toEqual({
      status: "listed",
      paymentSources: [
        expect.objectContaining({ asset: USDC_ADDRESS, amount: "250000" }),
        expect.objectContaining({ asset: EURC_ADDRESS, amount: "500000" }),
      ],
    });
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

    expect(result).toEqual({
      status: "listed",
      paymentSources: [
        {
          caip2Network: BASE_SEPOLIA,
          asset: USDC_ADDRESS,
          decimals: 6,
          payTo: PAY_TO,
          amount: "250000",
          credits: 0.5,
        },
      ],
    });
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
    ).toEqual({
      status: "dropped",
      reason: "conflicting_price",
    });
  });

  it("advertises a whitespace-padded registry asset in canonical trimmed form", () => {
    // `normalizeMasumiPaymentUnit` lowercases but does not trim, so a padded
    // unit survives ingestion. Every consumer of the advertised asset — the
    // readiness lookup, the CAIP-19 key, and the pay side's 402 matcher —
    // compares canonically trimmed lowercase, so a padded spelling would be
    // listed and then never match a demand.
    const result = buildX402AgentPaymentSources(
      [
        createSource({
          amounts: [
            {
              unit: ` ${USDC_ADDRESS.toUpperCase()} `,
              amount: 250000n,
              decimals: 6,
            },
          ],
        }),
      ],
      CONTEXT,
    );

    expect(result).toEqual({
      status: "listed",
      paymentSources: [
        expect.objectContaining({
          caip2Network: BASE_SEPOLIA,
          asset: USDC_ADDRESS,
        }),
      ],
    });
  });

  it("advertises a whitespace-padded registry payTo in canonical trimmed form", () => {
    const result = buildX402AgentPaymentSources(
      [createSource({ payTo: ` ${PAY_TO} ` })],
      CONTEXT,
    );

    expect(result).toEqual({
      status: "listed",
      paymentSources: [expect.objectContaining({ payTo: PAY_TO })],
    });
  });

  it("collapses a padded duplicate amount row into one advertised entry", () => {
    // Padding is not a second asset: the two rows say the same thing.
    const result = buildX402AgentPaymentSources(
      [
        createSource({
          amounts: [
            { unit: USDC_ADDRESS, amount: 250000n, decimals: 6 },
            { unit: ` ${USDC_ADDRESS}`, amount: 250000n, decimals: 6 },
          ],
        }),
      ],
      CONTEXT,
    );

    expect(result).toEqual({
      status: "listed",
      paymentSources: [
        {
          caip2Network: BASE_SEPOLIA,
          asset: USDC_ADDRESS,
          decimals: 6,
          payTo: PAY_TO,
          amount: "250000",
          credits: 0.5,
        },
      ],
    });
  });

  it("drops an agent whose padded duplicate unit carries a second price", () => {
    // Both rows pass readiness and pricing (those lookups trim), so an
    // untrimmed dedupe key would advertise the SAME effective triple at 0.5
    // and 10 credits — exactly the state conflicting_price exists to forbid.
    expect(
      buildX402AgentPaymentSources(
        [
          createSource({
            amounts: [
              { unit: USDC_ADDRESS, amount: 250000n, decimals: 6 },
              { unit: ` ${USDC_ADDRESS}`, amount: 5000000n, decimals: 6 },
            ],
          }),
        ],
        CONTEXT,
      ),
    ).toEqual({
      status: "dropped",
      reason: "conflicting_price",
    });
  });

  it("drops an agent whose mixed-case payTo repeats a triple at a second price", () => {
    // One recipient in two spellings. The advertised value keeps each source's
    // registry spelling, so only the dedupe KEY folds case — and without that
    // fold both entries would be advertised, at 0.5 and 10 credits for the
    // same (payTo, network, asset). The pay side matches payTo
    // case-insensitively and resolves the triple to exactly one amount row, so
    // the second advertisement would be a 402 it is guaranteed to reject
    // ("demanded amount exceeds the agent's advertised price") after the
    // coworker already called the agent.
    const checksummed = `0x${"aAbB".repeat(10)}`;

    expect(
      buildX402AgentPaymentSources(
        [
          createSource({ payTo: checksummed }),
          createSource({
            payTo: checksummed.toLowerCase(),
            amounts: [{ unit: USDC_ADDRESS, amount: 5000000n, decimals: 6 }],
          }),
        ],
        CONTEXT,
      ),
    ).toEqual({
      status: "dropped",
      reason: "conflicting_price",
    });
  });

  it("drops an agent whose padded payTo repeats a triple at a second price", () => {
    // Same recipient, one source spelling it padded. The pay side compares
    // payTo case- and whitespace-insensitively, so these are one triple.
    expect(
      buildX402AgentPaymentSources(
        [
          createSource(),
          createSource({
            payTo: ` ${PAY_TO} `,
            amounts: [{ unit: USDC_ADDRESS, amount: 5000000n, decimals: 6 }],
          }),
        ],
        CONTEXT,
      ),
    ).toEqual({
      status: "dropped",
      reason: "conflicting_price",
    });
  });

  it("collapses duplicate rows that disagree only on registry decimals", () => {
    // Registry decimals are a sanity gate, never the price input, so two rows
    // for one triple that differ ONLY there price identically off the node's
    // scale — one advertised entry, and the pay side's first-match resolution
    // agrees with either row. (Before the node's scale was trusted, the
    // registry's 6-vs-8 made these two different prices for one triple.)
    const result = buildX402AgentPaymentSources(
      [
        createSource({
          amounts: [
            { unit: USDC_ADDRESS, amount: 250000n, decimals: 6 },
            { unit: USDC_ADDRESS, amount: 250000n, decimals: 8 },
          ],
        }),
      ],
      CONTEXT,
    );

    expect(result).toEqual({
      status: "listed",
      paymentSources: [
        {
          caip2Network: BASE_SEPOLIA,
          asset: USDC_ADDRESS,
          decimals: NODE_DECIMALS,
          payTo: PAY_TO,
          amount: "250000",
          credits: 0.5,
        },
      ],
    });
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
    ).toEqual({
      status: "dropped",
      reason: "conflicting_price",
    });
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

    expect(result).toEqual({
      status: "listed",
      paymentSources: [
        expect.objectContaining({ payTo: PAY_TO, amount: "250000" }),
        expect.objectContaining({ payTo: OTHER_PAY_TO, amount: "5000000" }),
      ],
    });
  });

  it("drops the whole agent when one of several sources fails a gate", () => {
    // The agent picks which source its 402 demands, so one unpayable source
    // poisons the per-agent listed ⇒ payable promise.
    expect(
      buildX402AgentPaymentSources(
        [createSource(), createSource({ payTo: null })],
        CONTEXT,
      ),
    ).toEqual({
      status: "dropped",
      reason: "missing_pay_to",
    });
  });
});

describe("buildX402DynamicAgentPaymentSources", () => {
  it("lists a valid dynamic source as payable without inventing an amount or asset", () => {
    expect(
      buildX402DynamicAgentPaymentSources(
        [
          createSource({
            pricingType: PricingType.DYNAMIC,
            amounts: [],
          }),
        ],
        CONTEXT,
      ),
    ).toEqual({
      status: "listed",
      isPayable: true,
      hasUnpricedReadyPair: false,
      paymentSources: [
        {
          pricingType: "dynamic",
          caip2Network: BASE_SEPOLIA,
          payTo: PAY_TO,
        },
      ],
    });
  });

  it("rejects fixed and unknown sources from the dynamic listing path", () => {
    for (const pricingType of [PricingType.FIXED, PricingType.UNKNOWN]) {
      expect(
        buildX402DynamicAgentPaymentSources(
          [createSource({ pricingType })],
          CONTEXT,
        ),
      ).toEqual({ status: "dropped", reason: "pricing_not_dynamic" });
    }
  });

  it("reports mixed pricing before validating dynamic source fields", () => {
    expect(
      buildX402DynamicAgentPaymentSources(
        [
          createSource({
            pricingType: PricingType.DYNAMIC,
            payTo: "not-an-address",
            amounts: [],
          }),
          createSource({ pricingType: PricingType.FIXED }),
        ],
        CONTEXT,
      ),
    ).toEqual({ status: "dropped", reason: "pricing_not_dynamic" });
  });

  it("keeps dynamic listings inside the deployment network", () => {
    expect(
      buildX402DynamicAgentPaymentSources(
        [
          createSource({
            pricingType: PricingType.DYNAMIC,
            network: BASE_MAINNET,
            amounts: [],
          }),
        ],
        CONTEXT,
      ),
    ).toEqual({ status: "dropped", reason: "network_not_allowed" });
  });

  it("keeps a valid dynamic source visible but non-payable without a priced ready asset", () => {
    expect(
      buildX402DynamicAgentPaymentSources(
        [
          createSource({
            pricingType: PricingType.DYNAMIC,
            amounts: [],
          }),
        ],
        { ...CONTEXT, readySources: [] },
      ),
    ).toEqual({
      status: "listed",
      isPayable: false,
      // No matching ready pair was probed at all, so this is "not ready",
      // not "ready but unpriced".
      hasUnpricedReadyPair: false,
      paymentSources: [
        {
          pricingType: "dynamic",
          caip2Network: BASE_SEPOLIA,
          payTo: PAY_TO,
        },
      ],
    });
  });

  it("fails closed to non-payable AND reports to Sentry when the pricing probe hits duplicate CreditCost rows", () => {
    // Same misconfiguration as the fixed-path test, seen from the dynamic
    // probe: payability must not be granted on a broken price, but silently
    // converting the operator error into `isPayable: false` would leave it
    // with no loud surface at all.
    expect(
      buildX402DynamicAgentPaymentSources(
        [
          createSource({
            pricingType: PricingType.DYNAMIC,
            amounts: [],
          }),
        ],
        {
          ...CONTEXT,
          // Only the duplicated pair is ready, so the probe cannot fall
          // through to a healthy asset and mask the failure.
          readySources: READY_SOURCES.slice(0, 1),
          creditCosts: [
            createCreditCost(`${BASE_SEPOLIA}/erc20:${USDC_ADDRESS}`),
            createCreditCost(
              ` ${BASE_SEPOLIA}/erc20:${USDC_ADDRESS.toUpperCase()} `,
            ),
          ],
        },
      ),
    ).toEqual({
      status: "listed",
      isPayable: false,
      // The probe threw the MISCONFIGURATION, not the unpriced 422 — that
      // signal is Sentry's, not the unpriced tally's.
      hasUnpricedReadyPair: false,
      paymentSources: [
        {
          pricingType: "dynamic",
          caip2Network: BASE_SEPOLIA,
          payTo: PAY_TO,
        },
      ],
    });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("flags a ready-but-unpriced network as an unpriced preview, without Sentry", () => {
    // The pair is buy-side READY; only the CAIP-19 CreditCost row is missing.
    // That is ordinary operator lag, not the duplicate-row misconfiguration —
    // no Sentry, but the flag feeds the route's unpriced_dynamic_preview
    // tally so the state is not silent everywhere.
    expect(
      buildX402DynamicAgentPaymentSources(
        [
          createSource({
            pricingType: PricingType.DYNAMIC,
            amounts: [],
          }),
        ],
        { ...CONTEXT, creditCosts: [] },
      ),
    ).toEqual({
      status: "listed",
      isPayable: false,
      hasUnpricedReadyPair: true,
      paymentSources: [
        {
          pricingType: "dynamic",
          caip2Network: BASE_SEPOLIA,
          payTo: PAY_TO,
        },
      ],
    });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("does not flag an unpriced pair when a healthy pair makes the source payable", () => {
    // USDC is priced, EURC is ready but unpriced: the source IS payable, so
    // the unpriced sibling is not why anything is hidden — flagging it would
    // tally healthy deployments.
    expect(
      buildX402DynamicAgentPaymentSources(
        [
          createSource({
            pricingType: PricingType.DYNAMIC,
            amounts: [],
          }),
        ],
        {
          ...CONTEXT,
          creditCosts: [
            createCreditCost(`${BASE_SEPOLIA}/erc20:${USDC_ADDRESS}`),
          ],
        },
      ),
    ).toEqual({
      status: "listed",
      isPayable: true,
      hasUnpricedReadyPair: false,
      paymentSources: [
        {
          pricingType: "dynamic",
          caip2Network: BASE_SEPOLIA,
          payTo: PAY_TO,
        },
      ],
    });
  });

  it("advertises one preview for duplicate (payTo, network) dynamic sources", () => {
    // Mirrors the fixed builder's triple dedupe: a registry entry repeating a
    // source at distinct sourceIndex values is one preview, not two, and the
    // payTo case-folds like toAdvertisedPriceKey. The fixture MUST carry
    // letters — an all-digit address is byte-identical under toUpperCase and
    // would pin nothing about the fold.
    const checksummed = `0x${"aAbB".repeat(10)}`;
    expect(
      buildX402DynamicAgentPaymentSources(
        [
          createSource({
            pricingType: PricingType.DYNAMIC,
            payTo: checksummed,
            amounts: [],
          }),
          createSource({
            pricingType: PricingType.DYNAMIC,
            payTo: checksummed.toLowerCase(),
            amounts: [],
          }),
        ],
        CONTEXT,
      ),
    ).toEqual({
      status: "listed",
      isPayable: true,
      hasUnpricedReadyPair: false,
      paymentSources: [
        {
          pricingType: "dynamic",
          caip2Network: BASE_SEPOLIA,
          // The FIRST spelling is the advertised one, as in the fixed path.
          payTo: checksummed,
        },
      ],
    });
  });

  it("flags the unpriced preview even when a sibling ready pair is misconfigured", () => {
    // Composition of the two failure classes on one network: USDC has
    // duplicate CreditCost rows (misconfiguration -> Sentry), EURC has no row
    // at all (unpriced -> flag). No probe succeeded, so the source is
    // non-payable, BOTH signals fire, and they stay independent.
    expect(
      buildX402DynamicAgentPaymentSources(
        [
          createSource({
            pricingType: PricingType.DYNAMIC,
            amounts: [],
          }),
        ],
        {
          ...CONTEXT,
          creditCosts: [
            createCreditCost(`${BASE_SEPOLIA}/erc20:${USDC_ADDRESS}`),
            createCreditCost(
              ` ${BASE_SEPOLIA}/erc20:${USDC_ADDRESS.toUpperCase()} `,
            ),
          ],
        },
      ),
    ).toEqual({
      status: "listed",
      isPayable: false,
      hasUnpricedReadyPair: true,
      paymentSources: [
        {
          pricingType: "dynamic",
          caip2Network: BASE_SEPOLIA,
          payTo: PAY_TO,
        },
      ],
    });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("still reports a misconfigured pair probed AFTER a healthy pair, without losing payability", () => {
    // The probe must scan every matching pair, not short-circuit: a healthy
    // pair sorted first would otherwise mask the misconfigured pair's only
    // pre-pay signal. Payability is unaffected — one healthy priced pair is
    // enough.
    expect(
      buildX402DynamicAgentPaymentSources(
        [
          createSource({
            pricingType: PricingType.DYNAMIC,
            amounts: [],
          }),
        ],
        {
          ...CONTEXT,
          // EURC (healthy) probes before USDC (duplicated CreditCost rows).
          readySources: [...READY_SOURCES].reverse(),
          creditCosts: [
            createCreditCost(`${BASE_SEPOLIA}/erc20:${EURC_ADDRESS}`),
            createCreditCost(`${BASE_SEPOLIA}/erc20:${USDC_ADDRESS}`),
            createCreditCost(
              ` ${BASE_SEPOLIA}/erc20:${USDC_ADDRESS.toUpperCase()} `,
            ),
          ],
        },
      ),
    ).toEqual({
      status: "listed",
      isPayable: true,
      hasUnpricedReadyPair: false,
      paymentSources: [
        {
          pricingType: "dynamic",
          caip2Network: BASE_SEPOLIA,
          payTo: PAY_TO,
        },
      ],
    });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});

describe("reportX402PricingMisconfiguration", () => {
  it("classifies the pricing helper's own 422s as unpriced without reporting", () => {
    expect(
      reportX402PricingMisconfiguration(
        unprocessableEntity("Credit cost not found for unit x"),
      ),
    ).toBe(false);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("classifies and reports a 500-class HTTPException", () => {
    expect(
      reportX402PricingMisconfiguration(
        internalServerError("Multiple credit costs normalize to unit x"),
      ),
    ).toBe(true);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("classifies and reports a non-HTTPException throw instead of folding it into unpriced", () => {
    // The else arm is deliberate: a future programming error in the pricing
    // helper must surface as misconfiguration, not silently drop agents as
    // "unpriced" — the exact swallow the classifier exists to close.
    expect(
      reportX402PricingMisconfiguration(
        new TypeError("candidate.unit.trim is not a function"),
      ),
    ).toBe(true);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("dedupes by distinct error, still classifying every call", () => {
    const duplicate = () =>
      internalServerError("Multiple credit costs normalize to unit x");
    expect(reportX402PricingMisconfiguration(duplicate())).toBe(true);
    expect(reportX402PricingMisconfiguration(duplicate())).toBe(true);
    expect(
      reportX402PricingMisconfiguration(
        internalServerError("Multiple credit costs normalize to unit y"),
      ),
    ).toBe(true);
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
  });

  it("keys the dedupe on error name AND message, not message alone", () => {
    // Two different error classes with one coincidental message are two
    // defects; message-only keying would suppress the second's capture until
    // process restart.
    reportX402PricingMisconfiguration(new TypeError("boom"));
    reportX402PricingMisconfiguration(new RangeError("boom"));
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
  });

  it("survives an Error whose name accessor throws", () => {
    // Pins the guarded Error arm: instanceof Error passes, reading `name`
    // throws, the derivation falls back — a revert to the unguarded arm
    // (`${error.name}: ...` outside the try) fails this test by throwing.
    const hostile = Object.create(Error.prototype, {
      name: {
        get() {
          throw new Error("hostile accessor");
        },
      },
      message: { value: "irrelevant" },
    }) as Error;
    expect(reportX402PricingMisconfiguration(hostile)).toBe(true);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("survives an HTTPException whose status getter throws", () => {
    // The status read runs BEFORE the key derivation, so the guarded key
    // alone was not the floor — the classifier's outer catch is. Hostile
    // values are by definition not a known 422: classify as misconfiguration
    // and still capture.
    const hostile = unprocessableEntity("looks tame");
    Object.defineProperty(hostile, "status", {
      get() {
        throw new Error("hostile status accessor");
      },
    });
    expect(reportX402PricingMisconfiguration(hostile)).toBe(true);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("throttles hostile-value captures to once per process", () => {
    // The catch path cannot key a dedupe on values whose accessors throw, so
    // it throttles with a single module flag: a PERSISTENT hostile thrower
    // must not turn every listing GET into a Sentry event — the same volume
    // bound the keyed set gives well-behaved errors. A revert to an
    // unthrottled catch capture fails the count below.
    const hostile = unprocessableEntity("looks tame");
    Object.defineProperty(hostile, "status", {
      get() {
        throw new Error("hostile status accessor");
      },
    });
    expect(reportX402PricingMisconfiguration(hostile)).toBe(true);
    expect(reportX402PricingMisconfiguration(hostile)).toBe(true);
    expect(reportX402PricingMisconfiguration(hostile)).toBe(true);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    // The flag must not leak into the keyed path: a well-behaved
    // misconfiguration after a hostile one still gets its own capture.
    reportX402PricingMisconfiguration(new TypeError("well-behaved defect"));
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
  });

  it("keeps keyed captures from arming the hostile throttle", () => {
    // The other direction of non-interference: a mutant that also sets the
    // hostile flag in the KEYED path (say, a refactor consolidating the two
    // capture sites) would let any well-behaved misconfiguration reported
    // first permanently suppress the process's single hostile-classifier
    // capture — silently losing the only Sentry signal for a hostile
    // thrower. Keyed first, hostile second: both must capture.
    reportX402PricingMisconfiguration(new TypeError("well-behaved defect"));
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const hostile = unprocessableEntity("looks tame");
    Object.defineProperty(hostile, "status", {
      get() {
        throw new Error("hostile status accessor");
      },
    });
    expect(reportX402PricingMisconfiguration(hostile)).toBe(true);
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
  });

  it("never lets an exotic throw escape the classifier", () => {
    // Runs inside the builders' catch blocks — a secondary throw there would
    // 500 the whole listing off one poisoned agent. A null-prototype object
    // fails ToPrimitive, so bare String(error) would throw here.
    const exotic = Object.create(null) as object;
    expect(reportX402PricingMisconfiguration(exotic)).toBe(true);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    // And it dedupes like any other error.
    expect(reportX402PricingMisconfiguration(exotic)).toBe(true);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("clears the dedupe set on overflow and keeps deduping past the cap", () => {
    // Mirrors reportUnknownPurchaseValue: one repeated report per cycle beats
    // reinstating per-request volume for every error past the cap.
    for (let index = 0; index < 100; index += 1) {
      reportX402PricingMisconfiguration(
        internalServerError(`Multiple credit costs normalize to unit ${index}`),
      );
    }
    expect(captureExceptionMock).toHaveBeenCalledTimes(100);
    // Entry #101 overflows: the set is cleared, the new key is recorded, and
    // repeats of IT are deduped again rather than captured per call.
    const pastCap = () =>
      internalServerError("Multiple credit costs normalize to unit overflow");
    reportX402PricingMisconfiguration(pastCap());
    reportX402PricingMisconfiguration(pastCap());
    reportX402PricingMisconfiguration(pastCap());
    expect(captureExceptionMock).toHaveBeenCalledTimes(101);
    // The overflow CLEARED the set (it did not merely stop recording): a
    // pre-overflow key re-reports once. This is what distinguishes the real
    // bound from an unbounded set, which would still dedupe error #0 here.
    expect(
      reportX402PricingMisconfiguration(
        internalServerError("Multiple credit costs normalize to unit 0"),
      ),
    ).toBe(true);
    expect(captureExceptionMock).toHaveBeenCalledTimes(102);
  });
});

describe("buildX402AgentPricingListing", () => {
  it("propagates the unpriced-preview flag through the dynamic arm", () => {
    // Kills the hardcode-false mutant on the dynamic arm. The MIXED arm's
    // propagation is untestable today — see the comment at that arm: a listed
    // fixed source implies a priced ready pair on the only allowed network,
    // which keeps the dynamic flag down.
    expect(
      buildX402AgentPricingListing(
        [createSource({ pricingType: PricingType.DYNAMIC, amounts: [] })],
        { ...CONTEXT, creditCosts: [] },
      ),
    ).toMatchObject({
      status: "listed",
      pricingType: "dynamic",
      isPayable: false,
      hasUnpricedReadyPair: true,
    });
  });

  it("keeps the unpriced-preview flag DOWN through the dynamic arm when priced", () => {
    // The complement — kills the hardcode-TRUE mutant, which would tally
    // every payable dynamic agent as unpriced_dynamic_preview and send
    // operators chasing a CreditCost row that exists.
    expect(
      buildX402AgentPricingListing(
        [createSource({ pricingType: PricingType.DYNAMIC, amounts: [] })],
        CONTEXT,
      ),
    ).toMatchObject({
      status: "listed",
      pricingType: "dynamic",
      isPayable: true,
      hasUnpricedReadyPair: false,
    });
  });

  it("probes a ready pair whatever its cache spelling, like the fixed path", () => {
    // The probe's network compare normalizes both sides, mirroring
    // findX402ReadySource: cache rows ARE canonical today, but a raw compare
    // would make the probe the one consumer silently depending on that, and
    // a non-canonical row from a future context builder would skip a priced
    // pair here while the fixed gate matched it.
    expect(
      buildX402AgentPricingListing(
        [createSource({ pricingType: PricingType.DYNAMIC, amounts: [] })],
        {
          ...CONTEXT,
          readySources: [
            {
              caip2Network: " EIP155:84532 ",
              asset: USDC_ADDRESS,
              evmWalletId: "wallet-1",
              evmWalletAddress: EVM_WALLET_ADDRESS,
              decimals: NODE_DECIMALS,
            },
          ],
        },
      ),
    ).toMatchObject({
      status: "listed",
      pricingType: "dynamic",
      isPayable: true,
      hasUnpricedReadyPair: false,
    });
  });

  it("lists mixed fixed and dynamic sources without dropping the agent", () => {
    expect(
      buildX402AgentPricingListing(
        [
          createSource(),
          createSource({ pricingType: PricingType.DYNAMIC, amounts: [] }),
        ],
        CONTEXT,
      ),
    ).toEqual({
      status: "listed",
      pricingType: "mixed",
      isPayable: true,
      hasUnpricedReadyPair: false,
      paymentSources: [
        expect.objectContaining({ asset: USDC_ADDRESS, amount: "250000" }),
        {
          pricingType: "dynamic",
          caip2Network: BASE_SEPOLIA,
          payTo: PAY_TO,
        },
      ],
    });
  });
});
