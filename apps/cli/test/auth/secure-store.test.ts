import assert from "node:assert/strict";
import test from "node:test";

import {
  type CredentialStore,
  createCredentialStore,
} from "../../src/auth/secure-store.js";

interface StoredCredentials {
  authToken: string;
  refreshToken: string;
}

test("uses the native macOS credential entry without process arguments", () => {
  let storedPassword: string | null = null;
  let entryDetails: readonly string[] = [];
  let execCalls = 0;
  const execFileSync = (): string => {
    execCalls += 1;
    return "";
  };
  const store: CredentialStore<StoredCredentials> = createCredentialStore({
    platform: "darwin",
    execFileSync,
    entryFactory: (serviceName, accountName) => {
      entryDetails = [serviceName, accountName];
      return {
        getPassword: () => storedPassword,
        setPassword: (value) => {
          storedPassword = value;
        },
        deletePassword: () => {
          storedPassword = null;
          return true;
        },
      };
    },
    serviceName: "test-service",
    accountName: "test-account",
  });

  store.write({ authToken: "soko_mainnet_secret", refreshToken: "refresh" });

  assert.equal(execCalls, 0);
  assert.deepEqual(entryDetails, ["test-service", "test-account"]);
  assert.equal(
    storedPassword,
    JSON.stringify({
      authToken: "soko_mainnet_secret",
      refreshToken: "refresh",
    }),
  );
  assert.deepEqual(store.read(), {
    authToken: "soko_mainnet_secret",
    refreshToken: "refresh",
  });
  store.clear();
  assert.equal(storedPassword, null);
});

test("sanitizes native credential write errors", () => {
  const secret = "soko_mainnet_secret";
  const store = createCredentialStore<StoredCredentials>({
    platform: "darwin",
    entryFactory: () => ({
      getPassword: () => null,
      setPassword: () => {
        throw new Error(`native keyring failed for ${secret}`);
      },
      deletePassword: () => true,
    }),
  });

  assert.throws(
    () =>
      store.write({
        authToken: secret,
        refreshToken: "refresh",
      }),
    (error: unknown) => {
      assert.match(
        error instanceof Error ? error.message : String(error),
        /credential vault/,
      );
      assert.doesNotMatch(
        error instanceof Error ? error.message : String(error),
        new RegExp(secret),
      );
      return true;
    },
  );
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
