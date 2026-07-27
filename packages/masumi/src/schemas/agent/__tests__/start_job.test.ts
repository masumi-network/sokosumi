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
});
