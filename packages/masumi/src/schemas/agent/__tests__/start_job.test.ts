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

  it("rejects a payment-source index on a V1 response", () => {
    const result = startPaidJobResponseSchema.safeParse({
      ...paidJobResponse,
      paymentSourceType: "Web3CardanoV1",
      supportedPaymentSourceIndex: 3,
    });

    expect(result.success).toBe(false);
  });
});
