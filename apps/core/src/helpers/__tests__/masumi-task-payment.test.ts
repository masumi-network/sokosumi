import { describe, expect, it } from "vitest";

import {
  hasContradictoryMasumiTaskPaymentRail,
  isV2MasumiTaskPayment,
} from "../masumi-task-payment";

const V2_IDENTIFIER = `67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b${"ab".repeat(29)}000001`;
const V1_IDENTIFIER =
  "7e8bdaf2b2b919a3a4b94002cafb50086c0c845fe535d07a77ab7f77aabbccdd";

describe("isV2MasumiTaskPayment", () => {
  it("classifies an explicit V2 payment type as V2", () => {
    expect(
      isV2MasumiTaskPayment({
        agentIdentifier: V1_IDENTIFIER,
        paymentSourceType: "Web3CardanoV2",
      }),
    ).toBe(true);
  });

  it("classifies a V2 registry identifier as V2 without any explicit fields", () => {
    expect(isV2MasumiTaskPayment({ agentIdentifier: V2_IDENTIFIER })).toBe(
      true,
    );
  });

  it("keeps a bare index on V1 when no rail is declared", () => {
    expect(
      isV2MasumiTaskPayment({
        agentIdentifier: V1_IDENTIFIER,
        supportedPaymentSourceIndex: 0,
      }),
    ).toBe(false);
  });

  it("keeps a V1 payment on V1 when the seller echoes a stray index", () => {
    // Sellers on a newer SDK emit the index on V1 responses. Treating that as
    // V2 would put the payload through the V2 readiness gate and 422 it,
    // losing the coworker's completed work.
    expect(
      isV2MasumiTaskPayment({
        agentIdentifier: V1_IDENTIFIER,
        paymentSourceType: "Web3CardanoV1",
        supportedPaymentSourceIndex: 0,
      }),
    ).toBe(false);
  });

  it("still classifies as V2 when a V1 rail is declared on a V2 identifier", () => {
    // The identifier is authoritative: the node infers V2 from it, so this
    // payload must go through the V2 gates (and is rejected as contradictory).
    expect(
      isV2MasumiTaskPayment({
        agentIdentifier: V2_IDENTIFIER,
        paymentSourceType: "Web3CardanoV1",
      }),
    ).toBe(true);
  });

  it("classifies a plain V1 payment as V1", () => {
    expect(isV2MasumiTaskPayment({ agentIdentifier: V1_IDENTIFIER })).toBe(
      false,
    );
  });
});

describe("hasContradictoryMasumiTaskPaymentRail", () => {
  it("flags a declared V1 rail on a V2 registry identifier", () => {
    expect(
      hasContradictoryMasumiTaskPaymentRail({
        agentIdentifier: V2_IDENTIFIER,
        paymentSourceType: "Web3CardanoV1",
      }),
    ).toBe(true);
  });

  it("accepts a declared V1 rail on a V1 identifier", () => {
    expect(
      hasContradictoryMasumiTaskPaymentRail({
        agentIdentifier: V1_IDENTIFIER,
        paymentSourceType: "Web3CardanoV1",
        supportedPaymentSourceIndex: 0,
      }),
    ).toBe(false);
  });

  it("accepts a V2 identifier with no declared rail", () => {
    expect(
      hasContradictoryMasumiTaskPaymentRail({
        agentIdentifier: V2_IDENTIFIER,
      }),
    ).toBe(false);
  });
});
