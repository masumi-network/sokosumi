import assert from "node:assert/strict";
import test from "node:test";

import { createKeychainCredentialStore } from "../../src/auth/secure-store.mjs";

test("stores OAuth credentials as one keychain argument", () => {
  const calls = [];
  const execFileSync = (command, args, options) => {
    calls.push({ command, args, options });
    if (args[0] === "find-generic-password") {
      return JSON.stringify({
        authToken: "access-token",
        refreshToken: "refresh-token",
      });
    }
    return "";
  };
  const store = createKeychainCredentialStore({
    platform: "darwin",
    execFileSync,
    serviceName: "test-service",
    accountName: "test-account",
  });

  assert.deepEqual(store.read(), {
    authToken: "access-token",
    refreshToken: "refresh-token",
  });
  store.write({ authToken: "access-token", refreshToken: "refresh-token" });
  store.clear();

  assert.equal(calls[0].command, "/usr/bin/security");
  assert.deepEqual(calls[0].args.slice(0, 5), [
    "find-generic-password",
    "-a",
    "test-account",
    "-s",
    "test-service",
  ]);
  assert.deepEqual(calls[1].args.slice(0, 5), [
    "add-generic-password",
    "-a",
    "test-account",
    "-s",
    "test-service",
  ]);
  assert.equal(calls[1].args[5], "-w");
  assert.equal(
    calls[1].args[6],
    JSON.stringify({
      authToken: "access-token",
      refreshToken: "refresh-token",
    }),
  );
  assert.deepEqual(calls[2].args.slice(0, 5), [
    "delete-generic-password",
    "-a",
    "test-account",
    "-s",
    "test-service",
  ]);
});
