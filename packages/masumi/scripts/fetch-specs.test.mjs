import assert from "node:assert/strict";
import test from "node:test";

import {
  findMissingSpecLandmarks,
  isOlderVersion,
  SPEC_LANDMARKS,
} from "./fetch-specs.mjs";

test("version guard compares semver and fails closed on unparsable deployed versions", () => {
  assert.equal(isOlderVersion("1.2.2", "1.2.3"), true);
  assert.equal(isOlderVersion("1.2.3", "1.2.3"), false);
  assert.equal(isOlderVersion("2.0.0", "1.9.9"), false);
  // Unparsable deployed version vs a well-formed pinned one: refuse.
  assert.equal(isOlderVersion("beta", "1.2.3"), true);
  assert.equal(isOlderVersion(undefined, "1.2.3"), true);
  // No parsable pinned version to protect (first fetch): allow.
  assert.equal(isOlderVersion("1.2.3", undefined), false);
  assert.equal(isOlderVersion("beta", undefined), false);
});

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
      "PurchaseSources",
      "isPurchaseReady",
      "WithdrawAuthorized",
      "AuthorizeWithdrawalRequested",
    ],
  );
});

test("accepts a payment spec with the required V2 landmarks", () => {
  const v2Spec = {
    supportedPaymentSourceIndex: true,
    PurchaseSources: [],
    isPurchaseReady: true,
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
