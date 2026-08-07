import { describe, expect, it } from "vitest";

import { startPaidJobResponseSchema } from "../start_job.schema.js";

const paidJobResponse = {
  id: "job-1",
  input_hash: "input-hash",
  identifierFromPurchaser: "purchaser",
  blockchainIdentifier: "blockchain-id",
  payByTime: 1,
  submitResultTime: 2,
  unlockTime: 3,
  externalDisputeUnlockTime: 4,
  agentIdentifier: "agent-id",
  sellerVKey: "seller-vkey",
};

describe("startPaidJobResponseSchema", () => {
  it("preserves a V2 payment-source selection", () => {
    const result = startPaidJobResponseSchema.parse({
      ...paidJobResponse,
      paymentSourceType: "Web3CardanoV2",
      supportedPaymentSourceIndex: 3,
    });

    expect(result.paymentSourceType).toBe("Web3CardanoV2");
    expect(result.supportedPaymentSourceIndex).toBe(3);
  });

  it("keeps legacy responses backward compatible", () => {
    const result = startPaidJobResponseSchema.parse(paidJobResponse);

    expect(result.paymentSourceType).toBeUndefined();
    expect(result.supportedPaymentSourceIndex).toBeUndefined();
  });

  it("coerces a stringified payment-source index like the time fields", () => {
    const result = startPaidJobResponseSchema.parse({
      ...paidJobResponse,
      paymentSourceType: "Web3CardanoV2",
      supportedPaymentSourceIndex: "3",
    });

    expect(result.supportedPaymentSourceIndex).toBe(3);
  });

  it("treats a null payment-source index as absent, not index 0", () => {
    const result = startPaidJobResponseSchema.parse({
      ...paidJobResponse,
      supportedPaymentSourceIndex: null,
    });

    expect(result.supportedPaymentSourceIndex).toBeUndefined();
  });

  it("treats absent-intent junk as absent, never index 0", () => {
    for (const junk of ["", " ", false, [], {}, "abc"]) {
      const result = startPaidJobResponseSchema.parse({
        ...paidJobResponse,
        supportedPaymentSourceIndex: junk,
      });

      expect(result.supportedPaymentSourceIndex).toBeUndefined();
    }
  });

  it("accepts every payment-source type the protocol defines", () => {
    // A start_job response that fails to parse is reported as
    // `invalid-response`, and by then the seller has already accepted the job
    // — MIP-003 has no cancel. So a LEGAL value must never fail here.
    // `null` is what an x402/EVM source reports (the payment spec marks
    // paymentSourceType nullable on that branch) and `"None"` is the registry
    // spelling for an entry with no on-chain rail; both mean "no Cardano
    // source selected" and normalize to absent.
    for (const paymentSourceType of [null, "None"]) {
      const result = startPaidJobResponseSchema.parse({
        ...paidJobResponse,
        paymentSourceType,
      });

      expect(result.paymentSourceType).toBeUndefined();
    }
  });

  it("still rejects a payment-source type outside the protocol vocabulary", () => {
    const result = startPaidJobResponseSchema.safeParse({
      ...paidJobResponse,
      paymentSourceType: "Web3CardanoV3",
    });

    expect(result.success).toBe(false);
  });

  it("keeps a payment-source index on a V1 response for the caller to ignore", () => {
    // Sellers upgrading their SDK emit V2 fields on V1 responses. Failing
    // the parse would break those agents mid-rollout — and only after
    // start_job already ran — so the caller decides what to do with it.
    const result = startPaidJobResponseSchema.safeParse({
      ...paidJobResponse,
      paymentSourceType: "Web3CardanoV1",
      supportedPaymentSourceIndex: 3,
    });

    expect(result.success).toBe(true);
  });
});
