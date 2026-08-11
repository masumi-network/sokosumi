import { describe, expect, it } from "vitest";

import {
  isX402PaymentIdentifierAdvertised,
  normalizeX402PaymentRequired,
  X402_PAYMENT_IDENTIFIER_EXTENSION_KEY,
} from "../payment-required.schema.js";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAY_TO = "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea";

function v2Entry(overrides: Record<string, unknown> = {}) {
  return {
    scheme: "exact",
    network: "eip155:8453",
    amount: "1000",
    asset: USDC_BASE,
    payTo: PAY_TO,
    maxTimeoutSeconds: 3600,
    extra: { name: "USD Coin", version: "2" },
    ...overrides,
  };
}

function v1Entry(overrides: Record<string, unknown> = {}) {
  return {
    scheme: "exact",
    network: "base-sepolia",
    maxAmountRequired: "2500",
    resource: "https://agent.example.com/api",
    description: "An API call",
    mimeType: "application/json",
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    asset: USDC_BASE,
    ...overrides,
  };
}

describe("normalizeX402PaymentRequired", () => {
  it("passes a v2 JSON body through in the node shape", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      error: "Payment required",
      resource: { url: "https://agent.example.com/api" },
      accepts: [v2Entry()],
      extensions: {},
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      x402Version: 2,
      error: "Payment required",
      resource: { url: "https://agent.example.com/api" },
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "1000",
          asset: USDC_BASE,
          payTo: PAY_TO,
          maxTimeoutSeconds: 3600,
          extra: { name: "USD Coin", version: "2" },
        },
      ],
      extensions: {},
    });
  });

  it("normalizes a v1 body: maxAmountRequired → amount, network name → CAIP-2", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 1,
      error: "Payment required",
      accepts: [v1Entry()],
    });

    expect(result.isOk()).toBe(true);
    const normalized = result._unsafeUnwrap();
    expect(normalized.x402Version).toBe(1);
    expect(normalized.accepts).toEqual([
      {
        scheme: "exact",
        network: "eip155:84532",
        amount: "2500",
        asset: USDC_BASE,
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
      },
    ]);
    // v1 carries the resource per entry as a plain string.
    expect(normalized.resource).toEqual({
      url: "https://agent.example.com/api",
    });
  });

  it('maps "base" to eip155:8453', () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 1,
      accepts: [v1Entry({ network: "base" })],
    });
    expect(result._unsafeUnwrap().accepts[0]?.network).toBe("eip155:8453");
  });

  it("decodes the base64 PAYMENT-REQUIRED header transport", () => {
    const body = {
      x402Version: 2,
      accepts: [v2Entry()],
      extensions: {
        [X402_PAYMENT_IDENTIFIER_EXTENSION_KEY]: {
          info: { required: true },
        },
      },
    };
    const header = Buffer.from(JSON.stringify(body), "utf8").toString("base64");

    const result = normalizeX402PaymentRequired(header);

    expect(result.isOk()).toBe(true);
    const normalized = result._unsafeUnwrap();
    expect(normalized.x402Version).toBe(2);
    expect(normalized.accepts).toHaveLength(1);
    expect(isX402PaymentIdentifierAdvertised(normalized)).toBe(true);
  });

  it("rejects an unknown network name instead of guessing", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 1,
      accepts: [v1Entry({ network: "solana-devnet" })],
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(
      /Unknown x402 network "solana-devnet"/,
    );
  });

  it("rejects non-EVM CAIP-2 namespaces", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [v2Entry({ network: "solana:mainnet" })],
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/Unknown x402 network/);
  });

  it("lowercases a shouty CAIP-2 id", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [v2Entry({ network: "EIP155:8453" })],
    });
    expect(result._unsafeUnwrap().accepts[0]?.network).toBe("eip155:8453");
  });

  it("rejects conflicting amount spellings", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [v2Entry({ amount: "1000", maxAmountRequired: "2000" })],
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/Conflicting x402 amounts/);
  });

  it("accepts agreeing duplicate amount spellings", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 1,
      accepts: [v1Entry({ amount: "2500" })],
    });
    expect(result._unsafeUnwrap().accepts[0]?.amount).toBe("2500");
  });

  it("rejects an entry with no amount in either spelling", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [v2Entry({ amount: undefined })],
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/missing an amount/);
  });

  it("rejects a non-integer amount", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [v2Entry({ amount: "1.5" })],
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/Invalid x402 amount: 1.5/);
  });

  it("rejects an empty accepts array", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [],
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/Unparseable x402 402 payload/);
  });

  it("rejects structurally alien input loudly", () => {
    for (const input of [
      null,
      undefined,
      42,
      [],
      {},
      { accepts: [v2Entry()] }, // no x402Version
      { x402Version: 2 }, // no accepts
    ]) {
      const result = normalizeX402PaymentRequired(input);
      expect(result.isErr()).toBe(true);
    }
  });

  it("rejects a string that is not base64 JSON", () => {
    const result = normalizeX402PaymentRequired("not-actually-base64-json");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/did not decode to JSON/);
  });

  it("rejects an empty string payload", () => {
    const result = normalizeX402PaymentRequired("   ");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/Empty x402 payment-required/);
  });

  it("rejects a base64 string of a JSON scalar", () => {
    const header = Buffer.from(JSON.stringify("hello"), "utf8").toString(
      "base64",
    );
    const result = normalizeX402PaymentRequired(header);
    expect(result.isErr()).toBe(true);
  });
});

describe("isX402PaymentIdentifierAdvertised", () => {
  it("detects the advertised extension", () => {
    expect(
      isX402PaymentIdentifierAdvertised({
        extensions: {
          [X402_PAYMENT_IDENTIFIER_EXTENSION_KEY]: {
            info: { required: false },
          },
        },
      }),
    ).toBe(true);
  });

  it("is false without extensions, without the key, or with a non-object value", () => {
    expect(isX402PaymentIdentifierAdvertised({})).toBe(false);
    expect(isX402PaymentIdentifierAdvertised({ extensions: {} })).toBe(false);
    expect(
      isX402PaymentIdentifierAdvertised({
        extensions: { "builder-code": {} },
      }),
    ).toBe(false);
    expect(
      isX402PaymentIdentifierAdvertised({
        extensions: { [X402_PAYMENT_IDENTIFIER_EXTENSION_KEY]: null },
      }),
    ).toBe(false);
    expect(
      isX402PaymentIdentifierAdvertised({
        extensions: { [X402_PAYMENT_IDENTIFIER_EXTENSION_KEY]: "yes" },
      }),
    ).toBe(false);
  });
});
