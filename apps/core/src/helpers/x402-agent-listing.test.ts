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
    decimals: NODE_DECIMALS,
  },
  {
    caip2Network: BASE_SEPOLIA,
    asset: EURC_ADDRESS,
    evmWalletId: "wallet-1",
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
