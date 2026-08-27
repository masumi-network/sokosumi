import { describe, expect, it } from "vitest";

import {
  X402_MAX_ACCEPTS_ENTRIES,
  X402_MAX_ENCODED_PAYLOAD_LENGTH,
  X402_MAX_ERROR_LENGTH,
  X402_MAX_RAW_SCHEME_LENGTH,
  X402_MAX_TIMEOUT_SECONDS,
} from "./payment-required.limits.js";
import {
  isX402PaymentIdentifierAdvertised,
  narrowToChosenRequirement,
  normalizeX402PaymentRequired,
  X402_PAYMENT_IDENTIFIER_EXTENSION_KEY,
  x402PaymentRequiredSchema,
  x402PaymentRequirementsSchema,
} from "./payment-required.schema.js";
import { X402_SUPPORTED_SCHEMES } from "./payment-required.supported.js";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAY_TO = "0x52E29e0d2Aa49bfBfC548C0A9F2196F4aa51f3ea";
// Every Soko-side check canonicalizes with `.trim().toLowerCase()` before
// comparing, so the normalizer must emit what those checks will compare —
// otherwise the mismatch lands as a post-charge failure instead of a
// pre-charge rejection.
const USDC_BASE_CANONICAL = USDC_BASE.toLowerCase();
const PAY_TO_CANONICAL = PAY_TO.toLowerCase();

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

/**
 * Rebuilds a JSON value with every object's keys in reverse order, at every
 * depth — what a caller that round-tripped the entry through a different JSON
 * encoder holds. Canonical-JSON equality must see through it.
 */
function deepReorder(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepReorder);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, nested]) => [key, deepReorder(nested)]),
    );
  }
  return value;
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
          asset: USDC_BASE_CANONICAL,
          payTo: PAY_TO_CANONICAL,
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
        asset: USDC_BASE_CANONICAL,
        payTo: PAY_TO_CANONICAL,
        maxTimeoutSeconds: 60,
        // Unrecognized entry fields are forwarded; only the dialect
        // translations (maxAmountRequired→amount, per-entry resource) are
        // consumed.
        description: "An API call",
        mimeType: "application/json",
      },
    ]);
    // v1 carries the resource per entry as a plain string.
    expect(normalized.resource).toEqual({
      url: "https://agent.example.com/api",
    });
  });

  it("carries unknown alias fields through normalization verbatim", () => {
    // Live Bazaar entries carry aliases like `currency`/`recipient`. They are
    // forwarded, not stripped: the node ignores what it does not model, so
    // forwarding costs nothing, while stripping a key the node turns out to
    // propagate cannot be undone AFTER the charge (see the schema comment —
    // this is NOT a byte-identity guarantee, which normalization already
    // breaks by rewriting `network` and canonicalizing the addresses).
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [
        v2Entry({
          currency: "USDC",
          recipient: PAY_TO,
          outputSchema: { type: "object" },
        }),
      ],
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().accepts[0]).toMatchObject({
      amount: "1000",
      currency: "USDC",
      recipient: PAY_TO,
      outputSchema: { type: "object" },
    });
  });

  it("drops shadow keys that collide case-insensitively with a validated field", () => {
    // `PayTo` and `payTo` are DISTINCT JS keys, so writing the validated
    // fields after the unknown-key spread never mattered — the exact-case
    // keys are destructured out before the spread and could not collide
    // anyway. The real risk is that a shadow key survives normalization and
    // is FORWARDED: `/x402/pay`'s accepts item declares no
    // `additionalProperties: false`, so a second recipient spelling is
    // spec-legal and only the node's parser decides which one wins. Soko
    // must not hand it one at all — that is the whole point of
    // narrowToChosenRequirement.
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [
        v2Entry({
          PayTo: "0x1111111111111111111111111111111111111111",
          payto: "0x2222222222222222222222222222222222222222",
          Amount: "999999999",
          Network: "eip155:1",
          ASSET: "0x3333333333333333333333333333333333333333",
          maxamountrequired: "999999999",
          MaxTimeoutSeconds: 999_999,
          Extra: { name: "Evil Coin" },
          Resource: "https://evil.example.com/api",
        }),
      ],
    });

    expect(result.isOk()).toBe(true);
    const entry = result._unsafeUnwrap().accepts[0];
    expect(entry).toMatchObject({
      payTo: PAY_TO_CANONICAL,
      amount: "1000",
      network: "eip155:8453",
      asset: USDC_BASE_CANONICAL,
    });
    expect(entry?.PayTo).toBeUndefined();
    expect(entry?.payto).toBeUndefined();
    expect(entry?.Amount).toBeUndefined();
    expect(entry?.Network).toBeUndefined();
    expect(entry?.ASSET).toBeUndefined();
    expect(entry?.maxamountrequired).toBeUndefined();
    expect(entry?.MaxTimeoutSeconds).toBeUndefined();
    expect(entry?.Extra).toBeUndefined();
    expect(entry?.Resource).toBeUndefined();
    // The exact-case validated fields survive, and nothing else does.
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      "amount",
      "asset",
      "extra",
      "maxTimeoutSeconds",
      "network",
      "payTo",
      "scheme",
    ]);
  });

  it("drops a shadow key that hides behind surrounding whitespace", () => {
    // `"payTo "` and `" payTo"` are distinct JS keys that a
    // case-insensitive-only collision check let through, so a hostile 402
    // could still ship a second recipient spelling. Not a diversion risk on
    // its own — any key the node actually reads must be a byte-exact ASCII
    // spelling — but the collision check costs nothing extra to make
    // whitespace-insensitive, and a legitimate key never has surrounding
    // whitespace.
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [
        v2Entry({
          "payTo ": "0x1111111111111111111111111111111111111111",
          " payTo": "0x2222222222222222222222222222222222222222",
          "\tAMOUNT\n": "999999999",
          " resource ": "https://evil.example.com/api",
          // A non-colliding key still passes through, whitespace and all:
          // trimming decides only what COLLIDES, never what is emitted.
          " currency ": "USDC",
        }),
      ],
    });

    expect(result.isOk()).toBe(true);
    const entry = result._unsafeUnwrap().accepts[0];
    expect(entry).toMatchObject({
      payTo: PAY_TO_CANONICAL,
      amount: "1000",
      " currency ": "USDC",
    });
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      " currency ",
      "amount",
      "asset",
      "extra",
      "maxTimeoutSeconds",
      "network",
      "payTo",
      "scheme",
    ]);
  });

  it("strips prototype-polluting keys from everything it forwards", () => {
    // A top-level `__proto__` on an entry disappeared only INCIDENTALLY —
    // zod assigns unknown keys with `obj[k] = v`, which hits the prototype
    // setter — and `constructor` survived even there. One level deeper
    // nothing touched them at all. Measured forwarded bodies before this fix:
    //   {"outputSchema":{"__proto__":{"polluted":3}}}
    //   {"extra":{"name":"n","deep":{"__proto__":{"isAdmin":true}}}}
    //   {"extensions":{"payment-identifier":{"__proto__":{"isAdmin":true},…}}}
    // masumi-payment-service is Node/TS, so any deep-merge or recursive
    // `Object.assign` over that subtree makes Soko the relay for a
    // prototype-pollution payload against a service the caller does not
    // deploy — the same fail-open-on-the-node's-parser reasoning that
    // justifies `dropShadowKeys`.
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [
        v2Entry({
          ...JSON.parse('{"__proto__":{"polluted":1}}'),
          constructor: { polluted: 2 },
          prototype: { polluted: 3 },
          outputSchema: JSON.parse('{"__proto__":{"polluted":4},"type":"o"}'),
          extra: JSON.parse(
            '{"name":"n","deep":{"__proto__":{"isAdmin":true},"keep":1}}',
          ),
        }),
      ],
      extensions: JSON.parse(
        '{"payment-identifier":{"__proto__":{"isAdmin":true},"info":{"required":true}}}',
      ),
    });

    expect(result.isOk()).toBe(true);
    const normalized = result._unsafeUnwrap();
    const forwarded = JSON.stringify(normalized);
    expect(forwarded).not.toContain("__proto__");
    expect(forwarded).not.toContain("constructor");
    expect(forwarded).not.toContain("prototype");
    expect(forwarded).not.toContain("polluted");
    expect(forwarded).not.toContain("isAdmin");
    // Only the dangerous keys go: every legitimate sibling still ships.
    expect(normalized.accepts[0]).toMatchObject({
      payTo: PAY_TO_CANONICAL,
      outputSchema: { type: "o" },
      extra: { name: "n", deep: { keep: 1 } },
    });
    expect(isX402PaymentIdentifierAdvertised(normalized)).toBe(true);
    expect(normalized.extensions).toEqual({
      [X402_PAYMENT_IDENTIFIER_EXTENSION_KEY]: { info: { required: true } },
    });
  });

  it("rejects a payload nested deeper than the sanitizer can walk", () => {
    // A recursive walk over attacker-authored data needs a depth bound, or a
    // `{"a":{"a":{"a":…` body becomes a RangeError thrown out of a function
    // that must only ever return a Result.
    let deep: unknown = "leaf";
    for (let index = 0; index < 200; index += 1) {
      deep = { deep };
    }

    const call = () =>
      normalizeX402PaymentRequired({
        x402Version: 2,
        accepts: [v2Entry({ outputSchema: deep })],
      });

    expect(call).not.toThrow();
    expect(call().isErr()).toBe(true);
  });

  it("returns a failed result for a payload whose property read throws", () => {
    // The sanitizer is the FIRST thing to touch the payload and the choke
    // point that rebuilds it into plain data before zod sees it — `safeParse`
    // throws on the same input. A throwing enumerable getter is unreachable
    // from `JSON.parse` output, so neither live transport produces one, but a
    // caller handing this exported normalizer a hand-built payload can, and
    // the documented contract is a fail-closed Result rather than a 500.
    const hostile: Record<string, unknown> = {
      x402Version: 2,
      accepts: [v2Entry()],
    };
    Object.defineProperty(hostile, "boom", {
      enumerable: true,
      get() {
        throw new TypeError("property read exploded");
      },
    });

    const call = () => normalizeX402PaymentRequired(hostile);

    expect(call).not.toThrow();
    expect(call().isErr()).toBe(true);
  });

  it("rejects an asset or payTo that is not an EVM address", () => {
    // `payTo` is the recipient that gets signed into the EIP-3009
    // authorization and `asset` selects the token contract. Accepting a
    // non-address here does not divert funds by itself, but it defers the
    // failure past the credit charge and bakes in a validate-one-value /
    // forward-another split.
    for (const overrides of [
      { payTo: "not-an-address" },
      { asset: "USDC" },
      { payTo: `${PAY_TO}00` },
      { asset: "0x" },
    ]) {
      const result = normalizeX402PaymentRequired({
        x402Version: 2,
        accepts: [v2Entry(overrides)],
      });
      expect(result.isErr()).toBe(true);
    }
  });

  it("emits the trimmed, lowercased asset and payTo it validated", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [
        v2Entry({
          asset: `  ${USDC_BASE.toUpperCase().replace("0X", "0x")}  `,
          payTo: `  ${PAY_TO.toUpperCase().replace("0X", "0x")}`,
        }),
      ],
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().accepts[0]).toMatchObject({
      asset: USDC_BASE_CANONICAL,
      payTo: PAY_TO_CANONICAL,
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

  it("rejects an inherited Object.prototype key as a network name", () => {
    // `V1_NETWORK_NAME_TO_CAIP2[trimmed]` walks the prototype chain of an
    // object literal. Only `constructor` and `__proto__` survive the
    // preceding `.toLowerCase()`, and both return non-undefined, so
    // `normalizeX402NetworkId` returned `ok(<function Object>)` / `ok(Object.
    // prototype)` and pushed a NON-STRING `network`. Measured before this
    // fix, it still failed closed at the trailing re-validation — but with
    // the wrong error ("expected string, received function"), breaking the
    // file's fail-loud-never-guess contract, and it became a real bug the
    // moment `normalizeX402NetworkId` was reused without that trailing safeParse.
    for (const network of ["constructor", "__proto__", "toString", "valueOf"]) {
      const result = normalizeX402PaymentRequired({
        x402Version: 1,
        accepts: [v1Entry({ network })],
      });

      expect(result.isErr()).toBe(true);
      // Pinned in full, not by substring: the point is that the message is
      // the network one and nothing else — a non-string `network` slipping
      // through to the trailing re-validation reads as a DIFFERENT error.
      expect(result._unsafeUnwrapErr()).toBe(
        `No payable x402 requirement in accepts (1 refused): [0] Unknown x402 network "${network}"; expected a CAIP-2 id (eip155:*) or one of: base, base-sepolia`,
      );
    }
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

  it("rejects a leading-zero CAIP-2 chain id instead of emitting it as canonical", () => {
    // `eip155:08453` used to pass the pattern verbatim, minting a second
    // "canonical" spelling for chain 8453 — the exact thing the CAIP-19
    // unit-key design promises can never exist.
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [v2Entry({ network: "eip155:08453" })],
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/Unknown x402 network/);
  });

  it("rejects conflicting amount spellings", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [v2Entry({ amount: "1000", maxAmountRequired: "2000" })],
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/Conflicting x402 amounts/);
  });

  it("refuses a zero amount per entry, letting a payable sibling win", () => {
    // Refused at selection rather than downstream at pricing: a zero demand
    // skips the menu entry, it does not fail the whole payload.
    const zeroOnly = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [v2Entry({ amount: "0" })],
    });
    expect(zeroOnly.isErr()).toBe(true);
    expect(zeroOnly._unsafeUnwrapErr()).toMatch(/x402 amount is 0/);

    const withSibling = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [v2Entry({ amount: "0" }), v2Entry({ amount: "1000" })],
    });
    expect(withSibling.isOk()).toBe(true);
    expect(withSibling._unsafeUnwrap().accepts[0]?.amount).toBe("1000");
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

  it("refuses an omitted identity field per entry, letting a payable sibling win", () => {
    // Same menu rule as an unsupported scheme: one incomplete `accepts`
    // option must not fail `z.array(...)` and drop a neighbor Soko can pay.
    // Wrong TYPES stay payload-wide (malformed 402); omitted fields are
    // unpayable options.
    const fields = [
      "scheme",
      "network",
      "asset",
      "payTo",
      "maxTimeoutSeconds",
    ] as const;
    for (const field of fields) {
      const incompleteOnly = normalizeX402PaymentRequired({
        x402Version: 2,
        accepts: [v2Entry({ [field]: undefined })],
      });
      expect(incompleteOnly.isErr()).toBe(true);
      expect(incompleteOnly._unsafeUnwrapErr()).toMatch(
        new RegExp(`missing ${field}`),
      );
      expect(incompleteOnly._unsafeUnwrapErr()).not.toMatch(/Unparseable/);

      const withSibling = normalizeX402PaymentRequired({
        x402Version: 2,
        accepts: [v2Entry({ [field]: undefined }), v2Entry({ amount: "1000" })],
      });
      expect(withSibling.isOk()).toBe(true);
      expect(withSibling._unsafeUnwrap().accepts).toHaveLength(1);
      expect(withSibling._unsafeUnwrap().accepts[0]?.amount).toBe("1000");
    }
  });

  it("still refuses the whole payload when an identity field has the wrong type", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [v2Entry({ scheme: 1 }), v2Entry()],
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/Unparseable x402 402 payload/);
  });

  it("rejects a non-integer amount", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [v2Entry({ amount: "1.5" })],
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/Invalid x402 amount: 1.5/);
  });

  it("rejects a maxTimeoutSeconds above the cap in either dialect", () => {
    // maxTimeoutSeconds is the ONLY input to the signed authorization's
    // expiry (`validBefore = now + maxTimeoutSeconds`), and the X-PAYMENT
    // header is a bearer instrument until then. zod's `.int()` only bounds to
    // the safe-integer range, so without an explicit cap an attacker's 402
    // buys a never-expiring authorization against a wallet Soko keeps funded.
    for (const maxTimeoutSeconds of [
      Number.MAX_SAFE_INTEGER,
      X402_MAX_TIMEOUT_SECONDS + 1,
    ]) {
      expect(
        normalizeX402PaymentRequired({
          x402Version: 2,
          accepts: [v2Entry({ maxTimeoutSeconds })],
        }).isErr(),
      ).toBe(true);
      expect(
        normalizeX402PaymentRequired({
          x402Version: 1,
          accepts: [v1Entry({ maxTimeoutSeconds })],
        }).isErr(),
      ).toBe(true);
    }
  });

  it("accepts the widest maxTimeoutSeconds observed in the wild", () => {
    // research 001 §2 records 60–3600 s in live Bazaar listings, so the cap
    // must not turn a legitimate 402 into a pre-charge 422.
    expect(X402_MAX_TIMEOUT_SECONDS).toBe(3600);
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [v2Entry({ maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS })],
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().accepts[0]?.maxTimeoutSeconds).toBe(3600);
  });

  it("rejects a scheme outside the allowlist", () => {
    // Exactly the argument that pins `extra.assetTransferMethod`: Soko's own
    // settlement bookkeeping (`parseSignedX402Authorization`) reads an
    // EIP-3009 `{ nonce, validBefore }` tuple out of the signed payload, so a
    // scheme with different settlement semantics silently empties the
    // phased-settlement records. `upto` and `batch-settlement` are real
    // alternatives — `batch-settlement` adds `receiverAuthorizer` /
    // `withdrawDelay` — and a 402 declaring one with `assetTransferMethod`
    // omitted passed every other check.
    for (const scheme of ["upto", "batch-settlement", "Exact", "EXACT"]) {
      expect(
        normalizeX402PaymentRequired({
          x402Version: 2,
          accepts: [v2Entry({ scheme })],
        }).isErr(),
      ).toBe(true);
      expect(
        normalizeX402PaymentRequired({
          x402Version: 1,
          accepts: [v1Entry({ scheme })],
        }).isErr(),
      ).toBe(true);
    }
  });

  it("accepts every scheme on the allowlist", () => {
    expect(X402_SUPPORTED_SCHEMES).toEqual(["exact"]);
    for (const scheme of X402_SUPPORTED_SCHEMES) {
      expect(
        normalizeX402PaymentRequired({
          x402Version: 2,
          accepts: [v2Entry({ scheme })],
        }).isOk(),
      ).toBe(true);
    }
  });

  it("rejects an extra.assetTransferMethod other than eip3009", () => {
    // `extra.assetTransferMethod` selects which signing primitive the managed
    // wallet uses. Soko's own settlement bookkeeping
    // (`parseSignedX402Authorization`) reads an EIP-3009 authorization tuple
    // out of the signed payload, so any other method silently breaks the
    // phased-settlement records regardless of what the node does with it.
    for (const assetTransferMethod of ["permit2", "erc7710", "EIP3009", ""]) {
      const result = normalizeX402PaymentRequired({
        x402Version: 2,
        accepts: [
          v2Entry({
            extra: {
              name: "USD Coin",
              version: "2",
              ...{ assetTransferMethod },
            },
          }),
        ],
      });
      expect(result.isErr()).toBe(true);
    }
  });

  it("accepts an entry that names eip3009, or names no method at all", () => {
    expect(
      normalizeX402PaymentRequired({
        x402Version: 2,
        accepts: [
          v2Entry({
            extra: {
              name: "USD Coin",
              version: "2",
              assetTransferMethod: "eip3009",
            },
          }),
        ],
      }).isOk(),
    ).toBe(true);
    expect(
      normalizeX402PaymentRequired({
        x402Version: 2,
        accepts: [v2Entry()],
      }).isOk(),
    ).toBe(true);
  });

  it("rejects a non-string extra.name or extra.version", () => {
    // Both form the EIP-712 domain the authorization is signed under.
    for (const extra of [
      { name: 123, version: "2" },
      { name: "USD Coin", version: { major: 2 } },
    ]) {
      expect(
        normalizeX402PaymentRequired({
          x402Version: 2,
          accepts: [v2Entry({ extra })],
        }).isErr(),
      ).toBe(true);
    }
  });

  it("rejects an amount wider than uint256 or above the node's bigint max", () => {
    // A 100 000-digit amount normalizes cleanly today and only fails at the
    // node's POSTGRES_BIGINT_MAX check — i.e. AFTER the credit charge.
    for (const amount of [
      "1".repeat(100_000),
      "1".repeat(79),
      // 2^63, one past what the node can persist.
      "9223372036854775808",
    ]) {
      expect(
        normalizeX402PaymentRequired({
          x402Version: 2,
          accepts: [v2Entry({ amount })],
        }).isErr(),
      ).toBe(true);
    }

    expect(
      normalizeX402PaymentRequired({
        x402Version: 2,
        accepts: [v2Entry({ amount: "9223372036854775807" })],
      }).isOk(),
    ).toBe(true);
  });

  it("rejects oversized attacker-controlled strings pre-charge", () => {
    const oversized = [
      // The raw `scheme` cap lives in its own test below: it is the one
      // length bound an `isErr()` assertion cannot pin, because the scheme
      // allowlist refuses the same value for a different reason.
      {
        x402Version: 2,
        error: "x".repeat(1025),
        accepts: [v2Entry()],
      },
      {
        x402Version: 2,
        resource: { url: `https://a.example.com/${"p".repeat(2049)}` },
        accepts: [v2Entry()],
      },
      {
        x402Version: 1,
        accepts: [
          v1Entry({ resource: `https://a.example.com/${"p".repeat(2049)}` }),
        ],
      },
      {
        x402Version: 2,
        accepts: [v2Entry()],
        extensions: Object.fromEntries(
          Array.from({ length: 33 }, (_value, index) => [`ext-${index}`, {}]),
        ),
      },
      {
        x402Version: 2,
        accepts: [
          v2Entry({
            extra: Object.fromEntries(
              Array.from({ length: 33 }, (_value, index) => [
                `key-${index}`,
                "value",
              ]),
            ),
          }),
        ],
      },
    ];

    for (const payload of oversized) {
      expect(normalizeX402PaymentRequired(payload).isErr()).toBe(true);
    }
  });

  it("bounds the raw scheme by LENGTH, distinctly from the allowlist refusal", () => {
    // Asserting `isErr()` on an over-long scheme pins nothing: the allowlist
    // in `selectPayableRequirement` refuses any unsupported spelling whatever
    // its length, so deleting `X402_MAX_RAW_SCHEME_LENGTH` from the wild
    // schema left the whole suite green — the payload merely failed one fence
    // later, with a different message. Only the MESSAGE tells the two apart.
    const overLong = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [
        v2Entry({ scheme: "e".repeat(X402_MAX_RAW_SCHEME_LENGTH + 1) }),
      ],
    });
    const overLongError = overLong._unsafeUnwrapErr();

    expect(overLong.isErr()).toBe(true);
    // The wild schema refused it, so no entry was ever translated.
    expect(overLongError).toMatch(/^Unparseable x402 402 payload:/);
    expect(overLongError).toMatch(
      new RegExp(`<=\\s*${X402_MAX_RAW_SCHEME_LENGTH} characters`),
    );
    expect(overLongError).toMatch(/accepts\[0\]\.scheme/);
    expect(overLongError).not.toMatch(/Unsupported x402 scheme/);

    // One character shorter the payload PARSES, and the same value is refused
    // per entry by the allowlist instead — which is what the over-long case
    // silently fell through to while the cap was untested.
    const atCap = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [v2Entry({ scheme: "e".repeat(X402_MAX_RAW_SCHEME_LENGTH) })],
    });
    const atCapError = atCap._unsafeUnwrapErr();

    expect(atCap.isErr()).toBe(true);
    expect(atCapError).toMatch(/No payable x402 requirement in accepts/);
    expect(atCapError).toMatch(/Unsupported x402 scheme/);
    expect(atCapError).not.toMatch(/Unparseable x402 402 payload/);
  });

  it("bounds the entry's own key count and the size of every value", () => {
    // The `looseObject` retention decision stands — forwarding a key the node
    // ignores costs nothing, stripping one it turns out to propagate costs
    // money post-charge — but the "the extra surface is bounded" claim was
    // false. The cap only ever covered KEY COUNTS on `extensions` and
    // `extra`; the entry itself was a bare looseObject and no value had any
    // size bound. Measured before this fix: 5 000 unknown keys on an entry
    // passed and all 5 006 keys were forwarded, and `extra.blob` /
    // `extensions.big` at 1 MB each passed.
    const manyKeys = Object.fromEntries(
      Array.from({ length: 5000 }, (_value, index) => [`key-${index}`, "v"]),
    );
    const oversized = [
      { x402Version: 2, accepts: [v2Entry(manyKeys)] },
      {
        x402Version: 2,
        accepts: [v2Entry({ extra: { blob: "x".repeat(1_000_000) } })],
      },
      {
        x402Version: 2,
        accepts: [v2Entry()],
        extensions: { big: "y".repeat(1_000_000) },
      },
      // The same blob by another route: a 1 MB unknown key on the entry.
      {
        x402Version: 2,
        accepts: [v2Entry({ outputSchema: { blob: "z".repeat(1_000_000) } })],
      },
    ];

    for (const payload of oversized) {
      expect(normalizeX402PaymentRequired(payload).isErr()).toBe(true);
    }
  });

  it("still accepts a realistically sized live entry", () => {
    // The bound must not turn a live Bazaar listing — whose largest field is
    // an `outputSchema` JSON schema — into a pre-charge 422.
    const result = normalizeX402PaymentRequired({
      x402Version: 1,
      accepts: [
        v1Entry({
          outputSchema: {
            type: "object",
            properties: Object.fromEntries(
              Array.from({ length: 20 }, (_value, index) => [
                `field${index}`,
                { type: "string", description: "a".repeat(80) },
              ]),
            ),
          },
        }),
      ],
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().accepts[0]?.outputSchema).toBeDefined();
  });

  it("bounds every attacker-controlled value it echoes back", () => {
    // A rejected 402's error string flows into the response body, the logs
    // and Sentry — once per entry, up to 20 entries. Measured before this
    // fix: a 200 000-char `network` produced a 200 086-char error, and two
    // 500 000-digit amounts a 1 000 053-char one. `network` was the only
    // wild-dialect string with no length cap at all.
    const payloads = [
      { x402Version: 2, accepts: [v2Entry({ network: "n".repeat(200_000) })] },
      {
        x402Version: 2,
        accepts: [
          v2Entry({
            amount: "1".repeat(500_000),
            maxAmountRequired: "2".repeat(500_000),
          }),
        ],
      },
      {
        x402Version: 2,
        accepts: [v2Entry({ amount: `1.${"5".repeat(500_000)}` })],
      },
      {
        x402Version: 1,
        accepts: [
          v1Entry({ resource: `https://a.example.com/${"p".repeat(2000)}` }),
          v1Entry({
            network: "base",
            resource: `https://b.example.com/${"p".repeat(2000)}`,
          }),
        ],
      },
    ];

    for (const payload of payloads) {
      const result = normalizeX402PaymentRequired(payload);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().length).toBeLessThan(1024);
    }
  });

  it("bounds the zod-issue detail, the largest echo in the file", () => {
    // Round 2 capped every hand-built echo and missed the zod one.
    // `z.prettifyError` output is unbounded and lands in the response body,
    // the logs and Sentry on every rejected 402. Measured before this fix:
    // 12 009 characters from a 20-entry payload with eight wrong-typed
    // fields per entry, and 13 739 with `maxAmountRequired` wrong too —
    // 12–13× the X402_MAX_ERROR_LENGTH this same file imposes on the 402's
    // own `error` blurb.
    const wrongTyped = {
      scheme: 1,
      network: 2,
      asset: 3,
      amount: 4,
      maxAmountRequired: 5,
      payTo: 6,
      maxTimeoutSeconds: "x",
      extra: 7,
      resource: 8,
    };
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: Array.from({ length: X402_MAX_ACCEPTS_ENTRIES }, () => ({
        ...wrongTyped,
      })),
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/Unparseable x402 402 payload/);
    expect(result._unsafeUnwrapErr().length).toBeLessThan(
      X402_MAX_ERROR_LENGTH,
    );
  });

  it("bounds the conflicting-resource echo at the full entry count", () => {
    // The round-2 test for this echo used TWO entries, so its `< 1024` bound
    // did not generalize: measured 1 890 characters at 20 entries, because
    // the echo is one truncated URL per pooled resource and there are up to
    // 21 of them.
    const result = normalizeX402PaymentRequired({
      x402Version: 1,
      accepts: Array.from({ length: X402_MAX_ACCEPTS_ENTRIES }, (_v, index) =>
        v1Entry({
          resource: `https://a${index}.example.com/${"p".repeat(80)}`,
        }),
      ),
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/Conflicting x402 resource URLs/);
    expect(result._unsafeUnwrapErr().length).toBeLessThan(
      X402_MAX_ERROR_LENGTH,
    );
  });

  it("still echoes a short network name in full", () => {
    // The truncation must not make the common operator-facing errors useless.
    const result = normalizeX402PaymentRequired({
      x402Version: 1,
      accepts: [v1Entry({ network: "base-mainnet-typo" })],
    });
    expect(result._unsafeUnwrapErr()).toMatch(
      /Unknown x402 network "base-mainnet-typo"/,
    );
  });

  it("rejects an empty accepts array", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [],
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/Unparseable x402 402 payload/);
  });

  it("rejects more than 20 accepts entries pre-charge (node maxItems)", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: Array.from({ length: 21 }, () => v2Entry()),
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/Unparseable x402 402 payload/);

    expect(
      normalizeX402PaymentRequired({
        x402Version: 2,
        accepts: Array.from({ length: 20 }, () => v2Entry()),
      }).isOk(),
    ).toBe(true);
  });

  it("rejects disagreeing per-entry resource URLs instead of guessing", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 1,
      accepts: [
        v1Entry(),
        v1Entry({ resource: "https://other.example.com/api" }),
      ],
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/Conflicting x402 resource URLs/);
  });

  it("hoists a top-level resource given as a plain string", () => {
    // The wild union allows `resource` as a STRING as well as an object, and
    // nothing exercised the string arm: a normalizer that ignored it entirely
    // — reading only `resource.url` — left the whole suite green.
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      resource: "https://top.example.com/api",
      accepts: [v2Entry()],
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().resource).toEqual({
      url: "https://top.example.com/api",
    });
  });

  it("pools a top-level string resource into the conflict fence", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 1,
      resource: "https://top.example.com/api",
      accepts: [v1Entry({ resource: "https://entry.example.com/api" })],
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/Conflicting x402 resource URLs/);
  });

  it("rejects a top-level resource that disagrees with a per-entry one", () => {
    // The pool includes the top-level v2 resource AND the per-entry v1
    // strings, so a hybrid 402 whose top-level url contradicts an entry url
    // is caught, not silently preferred.
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      resource: { url: "https://top.example.com/api" },
      accepts: [v1Entry({ resource: "https://entry.example.com/api" })],
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/Conflicting x402 resource URLs/);
  });

  it("treats an empty resource url as absent, not as a conflict", () => {
    // `resource: { url: "" }` is a MISSING value, not a second name for the
    // resource. Pooling it produced `Conflicting x402 resource URLs: ,
    // https://…` and refused a 402 that named exactly one resource.
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      resource: { url: "" },
      accepts: [v1Entry({ resource: "https://agent.example.com/api" })],
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().resource).toEqual({
      url: "https://agent.example.com/api",
    });
  });

  it("treats a whitespace-only per-entry resource as absent", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 1,
      accepts: [
        v1Entry({ resource: "   " }),
        v1Entry({ network: "base", resource: "https://agent.example.com/api" }),
      ],
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().resource).toEqual({
      url: "https://agent.example.com/api",
    });
  });

  it("omits the resource entirely when every url is empty", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      resource: { url: "" },
      accepts: [v2Entry()],
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().resource).toBeUndefined();
  });

  it("accepts agreeing per-entry resource URLs across entries", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 1,
      accepts: [v1Entry(), v1Entry({ network: "base" })],
    });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().resource).toEqual({
      url: "https://agent.example.com/api",
    });
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
    expect(result._unsafeUnwrapErr()).toMatch(/not base64-encoded JSON/);
  });

  it("caps the base64 header before it decodes and parses it", () => {
    // The one real asymmetry between the two dialects: a JSON body inherits
    // whatever limit the route sets on the request body, while the header
    // dialect decoded and `JSON.parse`d with no bound from this module at
    // all. Measured before this fix: a 66 667 028-character base64 header
    // decoded to ~50 MB and was parsed — rejected in 48 ms, but at full peak
    // allocation, and the resource server picks the size.
    const oversized = "A".repeat(X402_MAX_ENCODED_PAYLOAD_LENGTH + 1);

    const result = normalizeX402PaymentRequired(oversized);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(
      /x402 payment-required header is \d+ characters/,
    );
    expect(result._unsafeUnwrapErr().length).toBeLessThan(
      X402_MAX_ERROR_LENGTH,
    );
  });

  it("still decodes the largest header the schema would accept", () => {
    // The cap must not refuse a header carrying a payload every other bound
    // in this file allows: 20 entries at the serialized-size ceiling.
    const body = {
      x402Version: 2,
      accepts: Array.from({ length: X402_MAX_ACCEPTS_ENTRIES }, (_v, index) =>
        v2Entry({ outputSchema: { pad: "p".repeat(7800), index } }),
      ),
    };
    const header = Buffer.from(JSON.stringify(body), "utf8").toString("base64");

    // Pinned two-sided, like X402_MAX_TIMEOUT_SECONDS: asserting only that
    // the header FITS bounds the constant from below, so raising it to 256 MB
    // kept the suite green and silently reopened the allocation asymmetry the
    // cap exists to close.
    expect(X402_MAX_ENCODED_PAYLOAD_LENGTH).toBe(262_144);
    expect(header.length).toBeGreaterThan(200_000);
    expect(header.length).toBeLessThanOrEqual(X402_MAX_ENCODED_PAYLOAD_LENGTH);
    expect(normalizeX402PaymentRequired(header).isOk()).toBe(true);
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

describe("normalizeX402PaymentRequired: a mixed accepts array", () => {
  // `accepts` is a MENU of options and the client picks ONE, so an option
  // Soko cannot settle must not cost it an option it can. Refusing the whole
  // 402 was not hypothetical: research 001 §2 records `batch-settlement`
  // offered ALONGSIDE `exact` by live Base-mainnet resources (with
  // `receiverAuthorizer` / `withdrawDelay: 86400`) and notes that v2
  // exact/EVM standardizes Permit2 and ERC-7710 beside EIP-3009 — and Base
  // mainnet `eip155:8453` is exactly what X402_MAINNET_ALLOWED_CAIP2_NETWORKS
  // allows. The listing side composes payability from the registry plus
  // readiness rather than from the live 402, so every such agent stayed
  // listed while every call 422'd.
  //
  // Nothing is GUESSED by selecting per entry: an unsupported option is not
  // translated into a supported one, it is simply not selected, and
  // `narrowToChosenRequirement` forwards exactly one entry.
  const PAYABLE_NORMALIZED = {
    scheme: "exact",
    network: "eip155:8453",
    amount: "1000",
    asset: USDC_BASE_CANONICAL,
    payTo: PAY_TO_CANONICAL,
    maxTimeoutSeconds: 3600,
    extra: { name: "USD Coin", version: "2" },
  };

  /** Every reason one offered entry can be unselectable. */
  const UNSELECTABLE: ReadonlyArray<
    readonly [string, Record<string, unknown>]
  > = [
    [
      "an unsupported scheme (batch-settlement, live alongside exact)",
      v2Entry({
        scheme: "batch-settlement",
        extra: {
          name: "USD Coin",
          version: "2",
          receiverAuthorizer: PAY_TO,
          withdrawDelay: 86_400,
        },
      }),
    ],
    [
      "exact on a non-EVM chain",
      v2Entry({ network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpLKreadyKb" }),
    ],
    [
      "an unsupported transfer method (permit2, a v2 exact/EVM fallback)",
      v2Entry({
        extra: {
          name: "USD Coin",
          version: "2",
          assetTransferMethod: "permit2",
        },
      }),
    ],
    [
      "a timeout above the cap",
      v2Entry({ maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS + 1 }),
    ],
    ["an amount wider than uint256", v2Entry({ amount: "1".repeat(79) })],
    [
      "an amount above what the node can persist",
      v2Entry({ amount: "9223372036854775808" }),
    ],
    ["a non-integer amount", v2Entry({ amount: "1.5" })],
    ["no amount in either spelling", v2Entry({ amount: undefined })],
    [
      "disagreeing amount spellings",
      v2Entry({ amount: "1000", maxAmountRequired: "2000" }),
    ],
    ["a payTo that is not an address", v2Entry({ payTo: "not-an-address" })],
    ["an asset that is not an address", v2Entry({ asset: "USDC" })],
  ];

  for (const [label, unselectable] of UNSELECTABLE) {
    it(`selects the payable entry when the 402 also offers ${label}`, () => {
      // Both orderings: selection must not depend on the payable entry
      // coming first.
      for (const accepts of [
        [v2Entry(), unselectable],
        [unselectable, v2Entry()],
      ]) {
        const result = normalizeX402PaymentRequired({
          x402Version: 2,
          accepts,
        });

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap().accepts).toEqual([PAYABLE_NORMALIZED]);
      }
    });
  }

  it("still fails closed when that entry is the only one offered", () => {
    for (const [, unselectable] of UNSELECTABLE) {
      expect(
        normalizeX402PaymentRequired({
          x402Version: 2,
          accepts: [unselectable],
        }).isErr(),
      ).toBe(true);
    }
  });

  it("fails closed, naming every refusal, when no entry is payable", () => {
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [
        v2Entry({ scheme: "upto" }),
        v2Entry({
          network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpLKreadyKb",
        }),
      ],
    });

    expect(result.isErr()).toBe(true);
    const message = result._unsafeUnwrapErr();
    expect(message).toMatch(
      /^No payable x402 requirement in accepts \(2 refused\): /,
    );
    expect(message).toContain('[0] Unsupported x402 scheme "upto"');
    expect(message).toContain("[1] Unknown x402 network");
  });

  it("keeps the resource-conflict fence over entries it cannot select", () => {
    // The pool is built from EVERY wild entry, before selection: the fence is
    // about the payload as a whole — the coworker re-requests exactly one
    // resource — so an unselectable entry naming a second one must still be a
    // loud refusal, not a silent drop.
    const result = normalizeX402PaymentRequired({
      x402Version: 1,
      accepts: [
        v1Entry(),
        v1Entry({
          scheme: "batch-settlement",
          resource: "https://other.example.com/api",
        }),
      ],
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/Conflicting x402 resource URLs/);
  });

  it("bounds the no-payable-entry echo at the full entry count", () => {
    // One refusal per entry, up to 20, each echoing a network name at the raw
    // cap — the same reason the zod-issue and resource-pool echoes are
    // truncated as a whole rather than per value.
    const result = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: Array.from({ length: X402_MAX_ACCEPTS_ENTRIES }, (_v, index) =>
        v2Entry({ network: `unknown-chain-${index}`.padEnd(64, "x") }),
      ),
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatch(/No payable x402 requirement/);
    expect(result._unsafeUnwrapErr().length).toBeLessThan(
      X402_MAX_ERROR_LENGTH,
    );
  });
});

describe("the exported node-shape schemas", () => {
  // Both schemas are exported from `packages/masumi/src/schemas/index.ts` and
  // documented as "the node's v2 paymentRequired shape" — exactly what a pay
  // route or a replay path over a STORED payload reaches for. They must
  // behave like validators: a bad payload is a failed Result, never a throw
  // that turns a 422 into an unhandled 500.
  function nodeShapeEntry(overrides: Record<string, unknown> = {}) {
    return v2Entry({
      asset: USDC_BASE_CANONICAL,
      payTo: PAY_TO_CANONICAL,
      ...overrides,
    });
  }

  it("returns a failed result for a non-numeric amount instead of throwing", () => {
    // zod 4 runs `.refine()` even after an earlier check on the same schema
    // has failed, so an unguarded `BigInt(value)` inside the refine escapes
    // `safeParse` as a SyntaxError.
    for (const amount of ["abc", "12x", "", "1.5", "-1", "0x10", " 1"]) {
      const parseRequirements = () =>
        x402PaymentRequirementsSchema.safeParse(nodeShapeEntry({ amount }));
      const parsePayload = () =>
        x402PaymentRequiredSchema.safeParse({
          x402Version: 2,
          accepts: [nodeShapeEntry({ amount })],
        });

      expect(parseRequirements).not.toThrow();
      expect(parsePayload).not.toThrow();
      expect(parseRequirements().success).toBe(false);
      expect(parsePayload().success).toBe(false);
    }
  });

  it("rejects an over-wide amount without converting it to a BigInt", () => {
    // Non-short-circuiting also made `.max(78)` useless: a 10 000 000-digit
    // string still got a full (quadratic) BigInt conversion before the width
    // check could matter. The refine is the ONLY check that can raise the
    // bigint-maximum issue, so "exactly one issue, and it is the width one"
    // is a deterministic proof that the conversion never ran.
    const parsed = x402PaymentRequirementsSchema.safeParse(
      nodeShapeEntry({ amount: "1".repeat(10_000_000) }),
    );

    expect(parsed.success).toBe(false);
    const amountIssues = (parsed.error?.issues ?? []).filter(
      (issue) => issue.path.join(".") === "amount",
    );
    expect(amountIssues).toHaveLength(1);
    expect(amountIssues[0]?.code).toBe("too_big");
  });

  it("never throws for structurally alien input", () => {
    // `boundedMapCheck` calls Object.keys and JSON.stringify, both of which
    // throw on the wrong input, so the entry-level refine must not run when
    // the base type check has already failed.
    for (const input of [null, undefined, 42, "str", [], true, Number.NaN]) {
      expect(() =>
        x402PaymentRequirementsSchema.safeParse(input),
      ).not.toThrow();
      expect(() => x402PaymentRequiredSchema.safeParse(input)).not.toThrow();
      expect(x402PaymentRequirementsSchema.safeParse(input).success).toBe(
        false,
      );
      expect(x402PaymentRequiredSchema.safeParse(input).success).toBe(false);
    }
  });

  it("still accepts a well-formed node-shape entry", () => {
    expect(
      x402PaymentRequirementsSchema.safeParse(nodeShapeEntry()).success,
    ).toBe(true);
  });

  it("re-imposes the three options the wild schema deliberately loosens", () => {
    // The other half of the per-entry selection argument. `scheme`,
    // `extra.assetTransferMethod` and the `maxTimeoutSeconds` cap were
    // loosened in the WILD schema so one unsupported option costs only its
    // own entry, on the stated promise that this schema re-imposes all three
    // on whatever survives selection. Every test of that promise went through
    // `normalizeX402PaymentRequired`, where `selectPayableRequirement`
    // refuses the same three values first — so all three bounds could be
    // deleted here with the suite still green, and the load-bearing half of
    // the argument was unpinned. Fed DIRECTLY, this is the only gate.
    const unsupported = [
      { scheme: "upto" },
      { maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS + 1 },
      { extra: { assetTransferMethod: "permit2" } },
    ];

    for (const override of unsupported) {
      expect(
        x402PaymentRequirementsSchema.safeParse(nodeShapeEntry(override))
          .success,
      ).toBe(false);
      expect(
        x402PaymentRequiredSchema.safeParse({
          x402Version: 2,
          accepts: [nodeShapeEntry(override)],
        }).success,
      ).toBe(false);
    }

    // Two-sided, so the bounds cannot be satisfied by refusing everything.
    const supported = [
      { scheme: X402_SUPPORTED_SCHEMES[0] },
      { maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS },
      { extra: { assetTransferMethod: "eip3009" } },
    ];

    for (const override of supported) {
      expect(
        x402PaymentRequirementsSchema.safeParse(nodeShapeEntry(override))
          .success,
      ).toBe(true);
    }
  });

  it("refuses an emptied accepts array", () => {
    // `min(1)` is the structural nothing-payable backstop: selection empties
    // `accepts` one entry at a time, and the normalizer's own reasoned error
    // is what a caller sees today. This pins the backstop that has to hold if
    // a future edit loses that guard — an empty `accepts` must never be
    // forwarded to the node.
    expect(
      x402PaymentRequiredSchema.safeParse({ x402Version: 2, accepts: [] })
        .success,
    ).toBe(false);
    expect(
      x402PaymentRequiredSchema.safeParse({
        x402Version: 2,
        accepts: [nodeShapeEntry()],
      }).success,
    ).toBe(true);
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

  it("is false for an array value", () => {
    // `typeof [] === "object"`, so an array would otherwise read as an
    // advertised extension and let the pay route stamp a paymentIdentifier
    // the server never advertised — which the node answers with a 400.
    for (const extension of [[], [{ info: { required: true } }]]) {
      expect(
        isX402PaymentIdentifierAdvertised({
          extensions: { [X402_PAYMENT_IDENTIFIER_EXTENSION_KEY]: extension },
        }),
      ).toBe(false);
    }
  });
});

describe("narrowToChosenRequirement", () => {
  const multiEntry = normalizeX402PaymentRequired({
    x402Version: 2,
    error: "Payment required",
    resource: { url: "https://agent.example.com/api" },
    accepts: [
      v2Entry(),
      // Same chain, DIFFERENT asset: this is the entry that slips past
      // verifyX402DemandAgainstAgentSources (which only fences same-(network,
      // asset) entries) and is filtered node-side only if the node honours
      // preferredAsset.
      v2Entry({
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        payTo: "0x1111111111111111111111111111111111111111",
        amount: "999999",
      }),
    ],
    extensions: {
      [X402_PAYMENT_IDENTIFIER_EXTENSION_KEY]: { info: { required: true } },
    },
  })._unsafeUnwrap();

  it("drops every entry except the chosen one", () => {
    const chosen = multiEntry.accepts[0];
    if (!chosen) {
      expect.unreachable("fixture must have a first entry");
    }

    const narrowed = narrowToChosenRequirement(multiEntry, chosen);

    expect(narrowed.isOk()).toBe(true);
    expect(narrowed._unsafeUnwrap().accepts).toEqual([chosen]);
    expect(
      narrowed
        ._unsafeUnwrap()
        .accepts.some(
          (entry) =>
            entry.payTo === "0x1111111111111111111111111111111111111111",
        ),
    ).toBe(false);
  });

  it("changes nothing else about the payload", () => {
    const chosen = multiEntry.accepts[1];
    if (!chosen) {
      expect.unreachable("fixture must have a second entry");
    }

    const narrowed = narrowToChosenRequirement(
      multiEntry,
      chosen,
    )._unsafeUnwrap();

    expect(narrowed).toEqual({ ...multiEntry, accepts: [chosen] });
    expect(narrowed.x402Version).toBe(multiEntry.x402Version);
    expect(narrowed.error).toBe(multiEntry.error);
    expect(narrowed.resource).toEqual(multiEntry.resource);
    expect(narrowed.extensions).toEqual(multiEntry.extensions);
    expect(isX402PaymentIdentifierAdvertised(narrowed)).toBe(true);
  });

  it("returns a payload the node schema still accepts", () => {
    const chosen = multiEntry.accepts[0];
    if (!chosen) {
      expect.unreachable("fixture must have a first entry");
    }

    expect(
      x402PaymentRequiredSchema.safeParse(
        narrowToChosenRequirement(multiEntry, chosen)._unsafeUnwrap(),
      ).success,
    ).toBe(true);
  });

  it("does not mutate the payload it narrows", () => {
    const chosen = multiEntry.accepts[0];
    if (!chosen) {
      expect.unreachable("fixture must have a first entry");
    }

    narrowToChosenRequirement(multiEntry, chosen);

    expect(multiEntry.accepts).toHaveLength(2);
  });

  it("refuses a chosen entry that is not in accepts", () => {
    // The helper's entire job is fund-diversion defence, so it must not take
    // the caller's word for which entry the payload offered. An unverified
    // `chosen` would let a caller bug hand the node a `payTo` that never
    // appeared in the 402 Soko validated.
    const foreign = normalizeX402PaymentRequired({
      x402Version: 2,
      accepts: [
        v2Entry({ payTo: "0x1111111111111111111111111111111111111111" }),
      ],
    })._unsafeUnwrap().accepts[0];
    if (!foreign) {
      expect.unreachable("fixture must have an entry");
    }

    const narrowed = narrowToChosenRequirement(multiEntry, foreign);

    expect(narrowed.isErr()).toBe(true);
    expect(narrowed._unsafeUnwrapErr()).toMatch(
      /not one of the payload's accepts entries/,
    );
  });

  it("refuses a chosen entry mutated after it was verified", () => {
    const chosen = multiEntry.accepts[0];
    if (!chosen) {
      expect.unreachable("fixture must have a first entry");
    }

    const tampered = {
      ...chosen,
      payTo: "0x1111111111111111111111111111111111111111",
    };

    expect(narrowToChosenRequirement(multiEntry, tampered).isErr()).toBe(true);
  });

  it("accepts a value-equal entry that is not the same object", () => {
    // A caller that round-trips the entry through JSON (a replay path, a
    // queued job) still holds the entry the payload offered, in a different
    // key order. Identity alone would refuse it.
    const chosen = multiEntry.accepts[0];
    if (!chosen) {
      expect.unreachable("fixture must have a first entry");
    }
    const reordered = Object.fromEntries(
      Object.entries(chosen).reverse(),
    ) as typeof chosen;

    const narrowed = narrowToChosenRequirement(multiEntry, reordered);

    expect(narrowed.isOk()).toBe(true);
    expect(narrowed._unsafeUnwrap().accepts).toEqual([chosen]);
  });

  it("matches a reordered entry that carries a toJSON key", () => {
    // `toJSON` is a spec-legal unknown key on an `accepts` entry — it does not
    // collide case-insensitively with a validated field, so `dropShadowKeys`
    // passes it and the loose entry schema keeps it. It need not be callable:
    // the string "x" is enough.
    //
    // A serializer that short-circuits on `object.toJSON != null` then falls
    // back to plain `JSON.stringify`, which emits INSERTION order rather than
    // sorted order — so the round-tripped entry canonicalizes differently from
    // the payload's own and membership fails. The 402 fails closed, but a
    // resource server chooses when to trigger it, which makes the agent
    // unpayable on any path that round-trips the chosen entry (a replay, a
    // queued job). Measured before this fix: reordered round-trip match
    // `false` with `toJSON`, `true` without.
    for (const overrides of [
      { toJSON: "x" },
      { extra: { toJSON: "x", name: "USD Coin", version: "2" } },
      { outputSchema: { toJSON: "x", type: "object" } },
    ]) {
      const payload = normalizeX402PaymentRequired({
        x402Version: 2,
        accepts: [v2Entry(overrides)],
      })._unsafeUnwrap();
      const chosen = payload.accepts[0];
      if (!chosen) {
        expect.unreachable("fixture must have an entry");
      }

      const narrowed = narrowToChosenRequirement(
        payload,
        deepReorder(chosen) as typeof chosen,
      );

      expect(narrowed.isOk()).toBe(true);
      expect(narrowed._unsafeUnwrap().accepts).toEqual([chosen]);
    }
  });
});
