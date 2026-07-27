import assert from "node:assert/strict";
import test from "node:test";

import { findMissingSpecLandmarks, SPEC_LANDMARKS } from "./fetch-specs.mjs";

test("rejects an equal-version legacy payment spec", () => {
  const legacySpec = {
    info: { version: "1.0.0" },
    components: {
      schemas: {
        Purchase: {
          properties: {
            onChainState: { enum: ["FundsLocked", "ResultSubmitted"] },
          },
        },
      },
    },
  };

  assert.deepEqual(
    findMissingSpecLandmarks(legacySpec, SPEC_LANDMARKS.payment),
    [
      "supportedPaymentSourceIndex",
      "WithdrawAuthorized",
      "AuthorizeWithdrawalRequested",
    ],
  );
});

test("accepts a payment spec with the required V2 landmarks", () => {
  const v2Spec = {
    supportedPaymentSourceIndex: true,
    states: ["WithdrawAuthorized"],
    actions: ["AuthorizeWithdrawalRequested"],
  };

  assert.deepEqual(
    findMissingSpecLandmarks(v2Spec, SPEC_LANDMARKS.payment),
    [],
  );
});

test("accepts a registry spec with V2 and x402 landmarks", () => {
  const registrySpec = {
    SupportedPaymentSources: [],
    supersededByAgentIdentifier: null,
    x402ResourcesUrl: null,
    types: ["X402"],
    paymentTypes: ["Web3CardanoV2"],
  };

  assert.deepEqual(
    findMissingSpecLandmarks(registrySpec, SPEC_LANDMARKS.registry),
    [],
  );
});
