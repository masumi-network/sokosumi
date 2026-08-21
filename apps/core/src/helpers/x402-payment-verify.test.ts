import { PricingType } from "@sokosumi/database";
import {
  X402_MAX_TIMEOUT_SECONDS,
  X402_MIN_TIMEOUT_SECONDS,
} from "@sokosumi/masumi/schemas";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { TASK_X402_SIGN_REQUEST_TIMEOUT_MS } from "@/services/task-x402-payment.replay";

import type { X402AgentPaymentSourceRow } from "./x402-agent-listing";
import { verifyX402DemandAgainstAgentSources } from "./x402-payment-verify";

const BASE_SEPOLIA = "eip155:84532";
const BASE_MAINNET = "eip155:8453";
const USDC_ADDRESS = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const BASE_MAINNET_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const OTHER_ASSET = "0x2222222222222222222222222222222222222222";
const PAY_TO = "0x1111111111111111111111111111111111111111";
const OTHER_PAY_TO = "0x3333333333333333333333333333333333333333";

function createSource(
  overrides: Partial<X402AgentPaymentSourceRow> = {},
): X402AgentPaymentSourceRow {
  return {
    network: BASE_SEPOLIA,
    payTo: PAY_TO,
    scheme: "exact",
    pricingType: PricingType.FIXED,
    amounts: [{ unit: USDC_ADDRESS, amount: 250000n, decimals: 6 }],
    ...overrides,
  };
}

function createEntry(overrides: Record<string, unknown> = {}) {
  return {
    // `as const` because the schema pins scheme to the literal "exact";
    // a widened `string` is not assignable to X402PaymentRequirements.
    scheme: "exact" as const,
    network: BASE_SEPOLIA,
    asset: USDC_ADDRESS,
    amount: "250000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: { name: "USDC", version: "2" },
    ...overrides,
  };
}

function expect422(run: () => unknown, messagePattern: RegExp) {
  try {
    run();
    expect.unreachable("expected a 422 HTTPException");
  } catch (error) {
    expect(error).toBeInstanceOf(HTTPException);
    if (error instanceof HTTPException) {
      expect(error.status).toBe(422);
      expect(error.message).toMatch(messagePattern);
    }
  }
}

describe("verifyX402DemandAgainstAgentSources", () => {
  it("returns the canonical verified demand for a matching 402", () => {
    const entry = createEntry({
      network: "EIP155:84532",
      asset: USDC_ADDRESS.toUpperCase(),
    });

    const demand = verifyX402DemandAgainstAgentSources(
      [entry],
      [createSource()],
      "Preprod",
    );

    expect(demand).toEqual({
      pricingType: PricingType.FIXED,
      caip2Network: BASE_SEPOLIA,
      asset: USDC_ADDRESS,
      amount: "250000",
      payTo: PAY_TO,
      domainName: "USDC",
      domainVersion: "2",
      entry,
    });
  });

  it("rejects a source whose registered scheme is unsupported", () => {
    expect422(
      () =>
        verifyX402DemandAgainstAgentSources(
          [createEntry()],
          [createSource({ scheme: "upto" })],
          "Preprod",
        ),
      /does not match any.*registered payment sources/i,
    );
  });

  it("matches a registered scheme that differs only in case and padding", () => {
    // The registry mirrors agent-authored text; the demand's scheme is already
    // schema-pinned lowercase. Trim/fold on the source side only.
    const demand = verifyX402DemandAgainstAgentSources(
      [createEntry()],
      [createSource({ scheme: " EXACT " })],
      "Preprod",
    );

    expect(demand.entry).toBeDefined();
  });

  it("rejects a source whose scheme is not the demand's", () => {
    // Pins only that a non-matching scheme never matches. The stronger
    // property — the compare targets the DEMAND's own scheme rather than
    // allowlist membership — is untestable through this function while the
    // allowlist has a single entry (both compares answer identically for
    // every input); it is enforced by the predicate's shape in
    // `sourceIdentityMatches` and documented there.
    expect422(
      () =>
        verifyX402DemandAgainstAgentSources(
          [createEntry()],
          [createSource({ scheme: "fancy" })],
          "Preprod",
        ),
      /does not match any.*registered payment sources/i,
    );
  });

  it("does not return the agent-registered decimals as a pricing input", () => {
    // `decimals` scales the charge inversely and the registry copy is authored
    // by the agent being paid. The charge reads the NODE's published scale off
    // `X402ReadySource`; this matcher must not offer a second, cheaper one for
    // a caller to reach for by mistake.
    const demand = verifyX402DemandAgainstAgentSources(
      [createEntry()],
      [createSource()],
      "Preprod",
    );

    expect(demand).not.toHaveProperty("decimals");
  });

  it("returns the matched accepts entry itself, so the caller can forward only that one", () => {
    // The node picks which of the forwarded `accepts` it signs, and nothing
    // node-side constrains payTo. Callers narrow the payload to one entry —
    // which they can only do if the matcher says WHICH entry it verified,
    // by identity rather than by re-deriving it from the scalars.
    const other = createEntry({
      asset: "0x9999999999999999999999999999999999999999",
    });
    const matching = createEntry();

    const demand = verifyX402DemandAgainstAgentSources(
      [other, matching],
      [createSource()],
      "Preprod",
    );

    expect(demand.entry).toBe(matching);
  });

  it("returns payTo canonically lowercased, like caip2Network and asset", () => {
    // The returned scalar exists to be STORED and COMPARED; the spelling that
    // gets SIGNED lives on `entry`, which is forwarded verbatim. Echoing a
    // third spelling here was asymmetric with its two siblings and survived
    // only because every downstream comparison is `.toLowerCase()`-guarded —
    // an inconsistency two other layers were quietly compensating for.
    const demand = verifyX402DemandAgainstAgentSources(
      [createEntry({ payTo: PAY_TO.toUpperCase() })],
      [createSource()],
      "Preprod",
    );

    expect(demand.payTo).toBe(PAY_TO);
    // The forwarded entry keeps the 402's own spelling — that is what signs.
    expect(demand.entry.payTo).toBe(PAY_TO.toUpperCase());
  });

  it("matches a whitespace-padded registry payTo and unit", () => {
    // Registry ingestion stores whitespace verbatim (`payTo` is copied through
    // and `normalizeMasumiPaymentUnit` lowercases but never trims), while the
    // 402 normalizer emits canonically trimmed lowercase addresses. Without a
    // trim here a padded registry value LISTS cleanly (the listing trims) yet
    // can never match a demand — the coworker pays with a wasted agent call
    // and a confusing 422. `network` one line up already trimmed, which is
    // what made the omission look accidental rather than intended.
    const demand = verifyX402DemandAgainstAgentSources(
      [createEntry()],
      [
        createSource({
          payTo: `  ${PAY_TO}  `,
          amounts: [
            { unit: `\t${USDC_ADDRESS}\n`, amount: 250000n, decimals: 6 },
          ],
        }),
      ],
      "Preprod",
    );

    expect(demand.asset).toBe(USDC_ADDRESS);
    expect(demand.amount).toBe("250000");
  });

  it("rejects a payTo that matches no registered source", () => {
    expect422(
      () =>
        verifyX402DemandAgainstAgentSources(
          [createEntry({ payTo: OTHER_PAY_TO })],
          [createSource()],
          "Preprod",
        ),
      /does not match any of the listed agent's registered payment sources/,
    );
  });

  it("rejects a network that matches no registered source", () => {
    expect422(
      () =>
        verifyX402DemandAgainstAgentSources(
          [createEntry({ network: BASE_MAINNET })],
          [createSource()],
          "Preprod",
        ),
      /does not match/,
    );
  });

  it("rejects an asset that matches no registered amount row", () => {
    expect422(
      () =>
        verifyX402DemandAgainstAgentSources(
          [createEntry({ asset: OTHER_ASSET })],
          [createSource()],
          "Preprod",
        ),
      /does not match/,
    );
  });

  it.each([
    ["missing", undefined],
    ["wrong name", { name: "Counterfeit Coin", version: "2" }],
    ["wrong version", { name: "USDC", version: "9" }],
  ])("rejects %s EIP-712 domain metadata", (_label, extra) => {
    expect422(
      () =>
        verifyX402DemandAgainstAgentSources(
          [createEntry({ extra })],
          [createSource()],
          "Preprod",
        ),
      /trusted EIP-712 domain/i,
    );
  });

  it("uses trusted Base mainnet USDC domain metadata", () => {
    const entry = createEntry({
      network: BASE_MAINNET,
      asset: BASE_MAINNET_USDC,
      extra: { name: "USD Coin", version: "2" },
    });

    expect(
      verifyX402DemandAgainstAgentSources(
        [entry],
        [
          createSource({
            network: BASE_MAINNET,
            amounts: [
              { unit: BASE_MAINNET_USDC, amount: 250000n, decimals: 6 },
            ],
          }),
        ],
        "Mainnet",
      ),
    ).toEqual({
      pricingType: PricingType.FIXED,
      caip2Network: BASE_MAINNET,
      asset: BASE_MAINNET_USDC,
      amount: "250000",
      payTo: PAY_TO,
      domainName: "USD Coin",
      domainVersion: "2",
      entry,
    });
  });

  it("never matches a non-FIXED (FREE) source", () => {
    expect422(
      () =>
        verifyX402DemandAgainstAgentSources(
          [createEntry()],
          [createSource({ pricingType: PricingType.FREE })],
          "Preprod",
        ),
      /does not match/,
    );
  });

  it("matches a dynamic runtime quote without inventing a registered asset or amount", () => {
    const entry = createEntry({ amount: "987654" });

    const demand = verifyX402DemandAgainstAgentSources(
      [entry],
      [
        createSource({
          pricingType: PricingType.DYNAMIC,
          amounts: [],
        }),
      ],
      "Preprod",
    );

    expect(demand).toEqual({
      pricingType: PricingType.DYNAMIC,
      caip2Network: BASE_SEPOLIA,
      asset: USDC_ADDRESS,
      amount: "987654",
      payTo: PAY_TO,
      domainName: "USDC",
      domainVersion: "2",
      entry,
    });
  });

  it("still rejects FREE and UNKNOWN sources", () => {
    for (const pricingType of [PricingType.FREE, PricingType.UNKNOWN]) {
      expect422(
        () =>
          verifyX402DemandAgainstAgentSources(
            [createEntry()],
            [createSource({ pricingType })],
            "Preprod",
          ),
        /does not match/,
      );
    }
  });

  it("prefers an overlapping fixed source so dynamic cannot discard its ceiling", () => {
    expect422(
      () =>
        verifyX402DemandAgainstAgentSources(
          [createEntry({ amount: "250001" })],
          [
            createSource({ pricingType: PricingType.DYNAMIC, amounts: [] }),
            createSource(),
          ],
          "Preprod",
        ),
      /exceeds the agent's advertised price/,
    );
  });

  it("never matches a source without payTo", () => {
    expect422(
      () =>
        verifyX402DemandAgainstAgentSources(
          [createEntry()],
          [createSource({ payTo: null })],
          "Preprod",
        ),
      /does not match/,
    );
  });

  it("rejects a matched network outside the per-environment allowlist", () => {
    // Registered AND demanded on Base mainnet, but the deployment is Preprod.
    expect422(
      () =>
        verifyX402DemandAgainstAgentSources(
          [createEntry({ network: BASE_MAINNET })],
          [createSource({ network: BASE_MAINNET })],
          "Preprod",
        ),
      /not allowed in this environment/,
    );
  });

  it("rejects when decimals were never recorded", () => {
    expect422(
      () =>
        verifyX402DemandAgainstAgentSources(
          [createEntry()],
          [
            createSource({
              amounts: [
                { unit: USDC_ADDRESS, amount: 250000n, decimals: null },
              ],
            }),
          ],
          "Preprod",
        ),
      /No decimals recorded/,
    );
  });

  it("rejects a demand above the advertised registry price", () => {
    expect422(
      () =>
        verifyX402DemandAgainstAgentSources(
          [createEntry({ amount: "250001" })],
          [createSource()],
          "Preprod",
        ),
      /exceeds the agent's advertised price/,
    );
  });

  it("accepts a demand below the advertised registry price", () => {
    const demand = verifyX402DemandAgainstAgentSources(
      [createEntry({ amount: "100" })],
      [createSource()],
      "Preprod",
    );

    expect(demand.amount).toBe("100");
  });

  it("rejects same-pair entries that disagree on the signed terms", () => {
    // The node is only restricted by (network, asset); a second entry on the
    // chosen pair with a different payTo could be the one it signs.
    expect422(
      () =>
        verifyX402DemandAgainstAgentSources(
          [createEntry(), createEntry({ payTo: OTHER_PAY_TO })],
          [createSource()],
          "Preprod",
        ),
      /Conflicting 402 entries/,
    );
    expect422(
      () =>
        verifyX402DemandAgainstAgentSources(
          [createEntry(), createEntry({ amount: "100" })],
          [createSource()],
          "Preprod",
        ),
      /Conflicting 402 entries/,
    );
  });

  it("tolerates unmatched entries on OTHER pairs and picks the first registered match", () => {
    const demand = verifyX402DemandAgainstAgentSources(
      [
        createEntry({ network: BASE_MAINNET, payTo: OTHER_PAY_TO }),
        createEntry(),
      ],
      [createSource()],
      "Preprod",
    );

    expect(demand.caip2Network).toBe(BASE_SEPOLIA);
  });

  it("refuses a payment window too short to survive the sign round trip", () => {
    // `maxTimeoutSeconds` is the ONLY input to the signed authorization's
    // expiry: the node signs `validBefore = signTime + maxTimeoutSeconds`. A
    // listed agent publishing `maxTimeoutSeconds: 1` therefore mints a header
    // that is already dead by the time it reaches the coworker, and the
    // schema's floor of 1 let it through.
    //
    // The damage is entirely POST-charge, which is why it has to be caught
    // here. Finalize's expiry fence is correct to give `validBefore` no skew
    // tolerance — a false negative writes the terminal VERIFIED the refund
    // path refuses — so every such payment charges credits, holds PENDING with
    // no inline refund, burns all five sign attempts on replay and dies at
    // `x402_payment_sign_attempts_exhausted`. One operator ticket per payment,
    // repeatable at will.
    for (const maxTimeoutSeconds of [1, X402_MIN_TIMEOUT_SECONDS - 1]) {
      expect422(
        () =>
          verifyX402DemandAgainstAgentSources(
            [createEntry({ maxTimeoutSeconds })],
            [createSource()],
            "Preprod",
          ),
        /payment window/i,
      );
    }
  });

  it("accepts the shortest window seen on a live listing", () => {
    // Research 001 §2 records 60–3600 s across live Bazaar listings, so the
    // floor must not reject its own lower end.
    const demand = verifyX402DemandAgainstAgentSources(
      [createEntry({ maxTimeoutSeconds: X402_MIN_TIMEOUT_SECONDS })],
      [createSource()],
      "Preprod",
    );

    expect(demand.caip2Network).toBe(BASE_SEPOLIA);
  });

  it("leaves the window floor clear of the node request timeout", () => {
    // The hard floor is the sign call itself: Soko abandons it at
    // TASK_X402_SIGN_REQUEST_TIMEOUT_MS, so a window shorter than that cannot
    // survive even a successful round trip. The chosen floor is well beyond
    // it, because the window also has to outlast the coworker presenting the
    // header to the resource server — which is the whole point of it.
    expect(X402_MIN_TIMEOUT_SECONDS * 1000).toBeGreaterThan(
      TASK_X402_SIGN_REQUEST_TIMEOUT_MS,
    );
    expect(X402_MIN_TIMEOUT_SECONDS).toBeLessThan(X402_MAX_TIMEOUT_SECONDS);
  });

  it("matches across multiple sources by payTo", () => {
    const demand = verifyX402DemandAgainstAgentSources(
      [createEntry({ payTo: OTHER_PAY_TO })],
      [
        createSource(),
        createSource({
          payTo: OTHER_PAY_TO,
          amounts: [{ unit: USDC_ADDRESS, amount: 500000n, decimals: 6 }],
        }),
      ],
      "Preprod",
    );

    expect(demand.payTo).toBe(OTHER_PAY_TO);
  });
});
