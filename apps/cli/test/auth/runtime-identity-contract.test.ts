import assert from "node:assert/strict";
import test from "node:test";

import {
  assertActorForSurface,
  assertDeveloperCliApiKey,
  assertRuntimeApiKey,
  classifyApiKeyActor,
  recursiveCliInvocationAllowed,
  runtimeMaySelfMintCoworkerKey,
  secretDeliveryModeForLifetime,
  sessionExpiryDeletesCoworkerIdentity,
} from "../../src/auth/runtime-identity-contract.js";

test("TestV81 classifies reserved API key prefixes by actor", () => {
  assert.equal(classifyApiKeyActor("coworker_abc"), "coworker");
  assert.equal(classifyApiKeyActor("soko_mainnet_abc"), "developer");
  assert.equal(classifyApiKeyActor("soko_preprod_abc"), "developer");
  assert.equal(classifyApiKeyActor("legacy_untagged"), "unknown");
  assert.equal(classifyApiKeyActor(""), "unknown");
});

test("TestV81 developer CLI rejects coworker keys and accepts user keys", () => {
  assert.throws(
    () => assertDeveloperCliApiKey("coworker_secret"),
    /Coworker API keys are not supported by the CLI/,
  );
  assert.doesNotThrow(() => assertDeveloperCliApiKey("soko_mainnet_secret"));
  assert.doesNotThrow(() =>
    assertActorForSurface("developer", "developer-cli"),
  );
  assert.doesNotThrow(() => assertActorForSurface("unknown", "developer-cli"));
});

test("TestV81 runtime accepts only coworker keys", () => {
  assert.doesNotThrow(() => assertRuntimeApiKey("coworker_secret"));
  assert.throws(
    () => assertRuntimeApiKey("soko_mainnet_secret"),
    /coworker_\* API key/,
  );
  assert.throws(
    () => assertActorForSurface("developer", "runtime"),
    /developer credentials are not allowed/,
  );
});

test("TestV82 session expiry does not delete Coworker identity", () => {
  assert.equal(sessionExpiryDeletesCoworkerIdentity(), false);
});

test("TestV82 secret delivery follows lifetime mode", () => {
  assert.equal(secretDeliveryModeForLifetime("session-only"), "session-memory");
  assert.equal(secretDeliveryModeForLifetime("retained"), "os-vault");
  assert.equal(secretDeliveryModeForLifetime("persistent-hosted"), "os-vault");
});

test("TestV83 runtime must not self-mint coworker keys", () => {
  assert.equal(runtimeMaySelfMintCoworkerKey(), false);
});

test("TestV84 recursive CLI entrypoint invocation is forbidden", () => {
  assert.equal(recursiveCliInvocationAllowed(), false);
});
