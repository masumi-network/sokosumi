import { describe, expect, it } from "vitest";

import {
  describeX402PaymentHeader,
  parseSignedX402Authorization,
  prepareX402ReplayHeader,
} from "./x402-settlement";

const FROM = "0x52e29e0d2aa49bfbfc548c0a9f2196f4aa51f3ea";
const TO = "0x1111111111111111111111111111111111111111";
const ASSET = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const NONCE = `0x${"cd".repeat(32)}`;
/** 65 bytes of hex — the shape an EIP-712 signature actually has. */
const SIGNATURE = `0x${"ab".repeat(65)}`;

function encode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function header(
  authorization: unknown,
  envelope: Record<string, unknown> = {},
  payloadOverrides: Record<string, unknown> = {},
): string {
  return encode({
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "eip155:84532",
      asset: ASSET,
      amount: "250000",
      payTo: TO,
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
      ...envelope,
    },
    payload: { signature: SIGNATURE, authorization, ...payloadOverrides },
  });
}

function authorization(overrides: Record<string, unknown> = {}) {
  return {
    from: FROM,
    to: TO,
    value: "250000",
    validAfter: "0",
    validBefore: "1775737949",
    nonce: NONCE,
    ...overrides,
  };
}

describe("parseSignedX402Authorization", () => {
  it("parses v1 and identifies its X-PAYMENT replay header", () => {
    const value = encode({
      x402Version: 1,
      scheme: "exact",
      network: "base-sepolia",
      payload: { signature: SIGNATURE, authorization: authorization() },
    });

    const parsed = parseSignedX402Authorization(value);
    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() && parsed.value).toMatchObject({
      x402Version: 1,
      network: "eip155:84532",
      asset: null,
      amount: null,
      payTo: null,
    });
    expect(describeX402PaymentHeader(value)._unsafeUnwrap()).toEqual({
      x402Version: 1,
      name: "X-PAYMENT",
      value,
    });
  });

  it("canonicalizes v1 replay headers and rejects permissive base64 spellings", () => {
    const canonical = encode({
      x402Version: 1,
      scheme: "exact",
      network: "base-sepolia",
      payload: { signature: SIGNATURE, authorization: authorization() },
    });

    expect(
      prepareX402ReplayHeader(`  ${canonical}\n`, {})._unsafeUnwrap(),
    ).toEqual({ x402Version: 1, name: "X-PAYMENT", value: canonical });
    expect(
      describeX402PaymentHeader(`  ${canonical}\n`)._unsafeUnwrap(),
    ).toEqual({ x402Version: 1, name: "X-PAYMENT", value: canonical });

    // Buffer.from(..., "base64") silently ignored this junk before, so v1
    // could store and replay a different spelling than the bytes Soko parsed.
    const nonCanonical = `${canonical.slice(0, 4)}!${canonical.slice(4)}`;
    expect(parseSignedX402Authorization(nonCanonical).isErr()).toBe(true);
    expect(prepareX402ReplayHeader(nonCanonical, {}).isErr()).toBe(true);
  });

  it("restores exact v2 accepted spelling and selects PAYMENT-SIGNATURE", () => {
    const source = {
      scheme: "exact",
      network: "eip155:84532",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      amount: "250000",
      payTo: "0x1111111111111111111111111111111111111111",
      maxTimeoutSeconds: 300,
      vendorExtension: { strict: true },
    };
    const replay = prepareX402ReplayHeader(
      header(authorization()),
      source,
    )._unsafeUnwrap();

    expect(replay.name).toBe("PAYMENT-SIGNATURE");
    const envelope = JSON.parse(
      Buffer.from(replay.value, "base64").toString("utf8"),
    ) as { accepted: unknown };
    expect(envelope.accepted).toEqual(source);
  });

  it("decodes the transfer the header actually authorizes", () => {
    const result = parseSignedX402Authorization(header(authorization()));

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }
    expect(result.value.from).toBe(FROM);
    expect(result.value.to).toBe(TO);
    expect(result.value.value).toBe(250_000n);
    expect(result.value.asset).toBe(ASSET);
    expect(result.value.amount).toBe(250_000n);
    expect(result.value.payTo).toBe(TO);
    expect(result.value.nonce).toBe(NONCE);
    expect(result.value.validBefore).toEqual(new Date(1_775_737_949_000));
    expect(result.value.validAfter).toEqual(new Date(0));
  });

  it("reads the settleability fields: scheme, network and validAfter", () => {
    // Who and how-much were already read. These are WHETHER the header can
    // settle at all — `accepted` names the chain and the settlement
    // semantics, and validAfter is the near end of the validity window. None
    // of them was read, so a header for the wrong chain, in a scheme with
    // different settlement behaviour, or one that does not open until the year
    // 5138 parsed exactly like a good one.
    const result = parseSignedX402Authorization(
      header(authorization({ validAfter: "1775737349" })),
    );

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      return;
    }
    expect(result.value.scheme).toBe("exact");
    expect(result.value.network).toBe("eip155:84532");
    expect(result.value.maxTimeoutSeconds).toBe(300);
    expect(result.value.validAfter).toEqual(new Date(1_775_737_349_000));
  });

  it("folds the v1 network spelling onto the CAIP-2 id the charge used", () => {
    // The charge is priced on a CAIP-2 id. If the parse compared spellings
    // rather than chains, a node answering the v1 alias for the very chain
    // that was charged would read as a chain mismatch and hold a good payment.
    // Same normalizer the 402 itself goes through.
    const result = parseSignedX402Authorization(
      header(authorization(), { network: "Base-Sepolia" }),
    );

    expect(result.isOk() && result.value.network).toBe("eip155:84532");
  });

  it("keeps addresses comparable by canonicalizing their case", () => {
    // EIP-55 checksummed addresses are legal on the wire; every Soko-side
    // comparison is lowercase, so the parse — not each caller — folds them.
    const result = parseSignedX402Authorization(
      header(authorization({ to: TO.toUpperCase().replace("0X", "0x") })),
    );

    expect(result.isOk() && result.value.to).toBe(TO);
  });

  it("canonicalizes the EIP-3009 nonce before replay-key storage", () => {
    const uppercaseNonce = `0x${"CD".repeat(32)}`;
    const result = parseSignedX402Authorization(
      header(authorization({ nonce: uppercaseNonce })),
    );

    expect(result.isOk() && result.value.nonce).toBe(NONCE);
  });

  it("accepts an integer numeric validBefore and refuses an out-of-range one", () => {
    expect(
      parseSignedX402Authorization(
        header(authorization({ validBefore: 1_775_737_949 })),
      )
        .map((value) => value.validBefore)
        ._unsafeUnwrap(),
    ).toEqual(new Date(1_775_737_949_000));

    // Finite but * 1000 overflows the JS Date range: an Invalid Date whose
    // getTime() is NaN must become null, never reach Prisma.
    expect(
      parseSignedX402Authorization(
        header(authorization({ validBefore: "1000000000000000" })),
      ).isErr(),
    ).toBe(true);
  });

  it.each([
    ["not base64-encoded JSON", "not-a-header"],
    ["JSON that is not an object", encode("nope")],
    [
      "a payload that is not an object",
      encode({ x402Version: 2, payload: "nope" }),
    ],
    ["a missing accepted object", encode({ x402Version: 2, payload: {} })],
    [
      "a missing authorization",
      encode({
        x402Version: 2,
        accepted: {
          scheme: "exact",
          network: "eip155:84532",
          asset: ASSET,
          amount: "250000",
          payTo: TO,
        },
        payload: {},
      }),
    ],
    ["an authorization that is not an object", header("nope")],
    ["a missing to", header(authorization({ to: undefined }))],
    ["a non-address to", header(authorization({ to: "0xnope" }))],
    ["a missing value", header(authorization({ value: undefined }))],
    ["a non-numeric value", header(authorization({ value: "1e6" }))],
    ["a numeric-typed value", header(authorization({ value: 250000 }))],
    ["a missing from", header(authorization({ from: undefined }))],
    ["a non-address from", header(authorization({ from: "0xnope" }))],
    ["a missing nonce", header(authorization({ nonce: undefined }))],
    ["a short nonce", header(authorization({ nonce: "0xabc" }))],
    [
      "a non-hex nonce",
      header(authorization({ nonce: `0x${"zz".repeat(32)}` })),
    ],
    [
      "a malformed validBefore",
      header(authorization({ validBefore: "not-a-number" })),
    ],
    ["a zero validBefore", header(authorization({ validBefore: "0" }))],
    [
      "a fractional validBefore",
      header(authorization({ validBefore: 1_775_737_949.5 })),
    ],
    ["a missing validAfter", header(authorization({ validAfter: undefined }))],
    ["a fractional validAfter", header(authorization({ validAfter: 0.5 }))],
    [
      "an empty validity window",
      header(authorization({ validAfter: "1775737949" })),
    ],
    [
      "a reversed validity window",
      header(authorization({ validAfter: "1775737950" })),
    ],
    ["a missing accepted asset", header(authorization(), { asset: null })],
    ["a malformed accepted asset", header(authorization(), { asset: "USDC" })],
    ["a missing accepted amount", header(authorization(), { amount: null })],
    ["a numeric accepted amount", header(authorization(), { amount: 250000 })],
    ["a missing accepted payTo", header(authorization(), { payTo: null })],
    [
      "a missing accepted maxTimeoutSeconds",
      header(authorization(), { maxTimeoutSeconds: null }),
    ],
    [
      "a fractional accepted maxTimeoutSeconds",
      header(authorization(), { maxTimeoutSeconds: 60.5 }),
    ],
    // Settleability. A header carrying none of these still described a
    // coherent transfer, so it parsed, was asserted against the charge, and
    // was stored VERIFIED — a terminal status refundRefusedTaskX402Payment
    // explicitly refuses — for an instrument that can never move a cent.
    ["no signature at all", header(authorization(), {}, { signature: null })],
    ["an empty signature", header(authorization(), {}, { signature: "" })],
    [
      "a non-hex signature",
      header(authorization(), {}, { signature: "0xsig" }),
    ],
    [
      "a signature that is not a string",
      header(authorization(), {}, { signature: { r: 1, s: 2 } }),
    ],
    // Shape alone was not a fence: `/^0x[0-9a-fA-F]+$/` accepted four bytes of
    // hex, which is not a signature under any scheme and can never recover a
    // signer. The exact width stays unpinned — ERC-1271 smart-account
    // signatures are variable-length — but a floor and byte alignment cost
    // nothing real.
    [
      "a signature far too short to be one",
      header(authorization(), {}, { signature: "0xdeadbeef" }),
    ],
    [
      "a signature one hex digit short of a whole byte",
      header(authorization(), {}, { signature: `0x${"ab".repeat(32)}c` }),
    ],
    [
      "a bare 0x prefix with no hex at all",
      header(authorization(), {}, { signature: "0x" }),
    ],
    ["a missing envelope scheme", header(authorization(), { scheme: null })],
    [
      "a non-string envelope scheme",
      header(authorization(), { scheme: ["exact"] }),
    ],
    ["a missing envelope network", header(authorization(), { network: null })],
    [
      "an unknown envelope network",
      header(authorization(), { network: "solana-devnet" }),
    ],
  ])("refuses %s", (_label, encoded) => {
    // Hard failure, never a forgiving null: this is the only view Soko has of
    // what its managed wallet actually signed. A caller that cannot read it
    // cannot assert the transfer matches the charge, and must hold the
    // payment rather than store an unverified header as VERIFIED.
    const result = parseSignedX402Authorization(encoded);

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error.length).toBeGreaterThan(0);
  });

  it("accepts a 32-byte signature and anything longer", () => {
    // The floor must not reject a real instrument. 32 bytes is the minimum
    // width worth calling a signature; a plain ECDSA one is 65 bytes and an
    // ERC-1271 smart-account signature is arbitrarily longer, so no exact
    // length may be pinned.
    for (const bytes of [32, 65, 200]) {
      const result = parseSignedX402Authorization(
        header(authorization(), {}, { signature: `0x${"ab".repeat(bytes)}` }),
      );

      expect(result.isOk()).toBe(true);
    }
  });

  it("reports the envelope scheme exactly as the facilitator will read it", () => {
    // A facilitator reads `scheme` VERBATIM. Folding it with
    // `.trim().toLowerCase()` here meant "Exact" and "  exact  " passed Soko's
    // supported-scheme fence and then settled against nothing — the fence
    // checked a string the settlement layer never sees. The 402 side is strict
    // (`z.enum(["exact"])`), so this is the asymmetry that let a drifted
    // spelling through on the signed side only.
    for (const scheme of ["Exact", "  exact  ", "EXACT"]) {
      const result = parseSignedX402Authorization(
        header(authorization(), { scheme }),
      );

      expect(result.isOk()).toBe(true);
      expect(result.isOk() && result.value.scheme).toBe(scheme);
    }
  });

  it("refuses an oversized header before decoding it", () => {
    // Bounded before Buffer.from + JSON.parse each allocate: checking after
    // decoding is checking after paying for it.
    const result = parseSignedX402Authorization("A".repeat(300_000));

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error).toMatch(/characters/);
  });
});
