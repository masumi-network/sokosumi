import assert from "node:assert/strict";
import type { ExecFileSyncOptions } from "node:child_process";
import test from "node:test";

import {
  type CredentialStore,
  createCredentialStore,
} from "../../src/auth/secure-store.js";

interface Call {
  command: string;
  args: readonly string[];
  options: ExecFileSyncOptions;
}

interface StoredCredentials {
  authToken: string;
  refreshToken: string;
}

test("stores OAuth credentials in macOS Keychain arguments", () => {
  const calls: Call[] = [];
  const execFileSync = (
    command: string,
    args: readonly string[],
    options: ExecFileSyncOptions,
  ): string => {
    calls.push({ command, args, options });
    if (args[0] === "find-generic-password") {
      return JSON.stringify({
        authToken: "access-token",
        refreshToken: "refresh-token",
      });
    }
    return "";
  };
  const store: CredentialStore<StoredCredentials> = createCredentialStore({
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

  assert.equal(calls[0]?.command, "/usr/bin/security");
  assert.deepEqual(calls[0]?.args.slice(0, 5), [
    "find-generic-password",
    "-a",
    "test-account",
    "-s",
    "test-service",
  ]);
  assert.deepEqual(calls[1]?.args.slice(0, 5), [
    "add-generic-password",
    "-a",
    "test-account",
    "-s",
    "test-service",
  ]);
  assert.equal(calls[1]?.args[5], "-w");
  assert.equal(
    calls[1]?.args[6],
    JSON.stringify({
      authToken: "access-token",
      refreshToken: "refresh-token",
    }),
  );
  assert.deepEqual(calls[2]?.args.slice(0, 5), [
    "delete-generic-password",
    "-a",
    "test-account",
    "-s",
    "test-service",
  ]);
});

test("fails closed when Linux Secret Service is unavailable", () => {
  const execFileSync = (): never => {
    const error = new Error("secret-tool not found") as Error & {
      code: string;
    };
    error.code = "ENOENT";
    throw error;
  };
  const store = createCredentialStore({
    platform: "linux",
    execFileSync,
  });

  assert.equal(store.isSupported, false);
  assert.throws(() => store.write({ authToken: "secret" }), /credential vault/);
});

test("uses the native Windows credential entry", () => {
  let storedPassword: string | null = null;
  const calls: string[] = [];
  const store = createCredentialStore<StoredCredentials>({
    platform: "win32",
    entryFactory: () => ({
      getPassword: () => storedPassword,
      setPassword: (value) => {
        calls.push("set");
        storedPassword = value;
      },
      deletePassword: () => {
        calls.push("delete");
        storedPassword = null;
        return true;
      },
    }),
  });

  store.write({ authToken: "access-token", refreshToken: "refresh-token" });
  assert.deepEqual(store.read(), {
    authToken: "access-token",
    refreshToken: "refresh-token",
  });
  store.clear();
  assert.deepEqual(calls, ["set", "delete"]);
  assert.equal(store.read(), null);
});
