import assert from "node:assert/strict";
import test from "node:test";

import { resolveTargetScope } from "../../src/auth/config.js";
import {
  type CredentialStore,
  createAuthCredentialStores,
  createCredentialStore,
} from "../../src/auth/secure-store.js";

interface StoredCredentials {
  authToken: string;
  refreshToken: string;
}

test("TestV28 custom target vault entries stay isolated across similar host names", () => {
  const entries = new Map<string, string>();
  const entryFactory = (serviceName: string, accountName: string) => {
    const key = `${serviceName}\0${accountName}`;
    return {
      getPassword: () => entries.get(key) || null,
      setPassword: (value: string) => {
        entries.set(key, value);
      },
      deletePassword: () => entries.delete(key),
    };
  };
  const hyphenHostScope = resolveTargetScope("custom", "https://a-b.example");
  const dottedHostScope = resolveTargetScope("custom", "https://a.b.example");
  const hyphenHostStores = createAuthCredentialStores({
    targetScope: hyphenHostScope,
    clientId: "cli-client",
    platform: "darwin",
    entryFactory,
  });
  const dottedHostStores = createAuthCredentialStores({
    targetScope: dottedHostScope,
    clientId: "cli-client",
    platform: "darwin",
    entryFactory,
  });

  assert.notEqual(hyphenHostScope, dottedHostScope);
  hyphenHostStores.apiKey.write({
    apiKey: "hyphen-host-key",
    target: "custom",
  });
  assert.deepEqual(hyphenHostStores.apiKey.read(), {
    apiKey: "hyphen-host-key",
    target: "custom",
  });
  assert.equal(dottedHostStores.apiKey.read(), null);

  dottedHostStores.apiKey.write({
    apiKey: "dotted-host-key",
    target: "custom",
  });
  assert.deepEqual(hyphenHostStores.apiKey.read(), {
    apiKey: "hyphen-host-key",
    target: "custom",
  });
  assert.deepEqual(dottedHostStores.apiKey.read(), {
    apiKey: "dotted-host-key",
    target: "custom",
  });
});
test("TestV29 custom target vault entries stay isolated in case-insensitive vaults", () => {
  const entries = new Map<string, string>();
  const entryFactory = (serviceName: string, accountName: string) => {
    const key = `${serviceName}\0${accountName}`.toLowerCase();
    return {
      getPassword: () => entries.get(key) || null,
      setPassword: (value: string) => {
        entries.set(key, value);
      },
      deletePassword: () => entries.delete(key),
    };
  };
  const uppercasePathStores = createAuthCredentialStores({
    targetScope: resolveTargetScope("custom", "https://example.test/A"),
    clientId: "cli-client",
    platform: "win32",
    entryFactory,
  });
  const lowercasePathStores = createAuthCredentialStores({
    targetScope: resolveTargetScope("custom", "https://example.test/a"),
    clientId: "cli-client",
    platform: "win32",
    entryFactory,
  });

  assert.match(
    resolveTargetScope("custom", "https://example.test/A"),
    /^custom-[0-9a-f]+$/u,
  );
  assert.notEqual(
    resolveTargetScope("custom", "https://example.test/A"),
    resolveTargetScope("custom", "https://example.test/a"),
  );
  uppercasePathStores.apiKey.write({
    apiKey: "uppercase-path-key",
    target: "custom",
  });
  assert.equal(lowercasePathStores.apiKey.read(), null);

  lowercasePathStores.apiKey.write({
    apiKey: "lowercase-path-key",
    target: "custom",
  });
  assert.deepEqual(uppercasePathStores.apiKey.read(), {
    apiKey: "uppercase-path-key",
    target: "custom",
  });
  assert.deepEqual(lowercasePathStores.apiKey.read(), {
    apiKey: "lowercase-path-key",
    target: "custom",
  });
});

test("TestV61 custom target scopes omit standalone key credentials", () => {
  const credentialUrl =
    "https://user:password@host/api?API_KEY=secret&key=key-value&access_key=access-value&Authorization=bearer-token&private-key=private-value&auth-key=auth-value&signature=signature-value&JWT=jwt-value&region=west#fragment";
  const distinctUrl =
    "https://other:password@host/api?authorization=other-secret&region=east";
  const scope = resolveTargetScope("custom", credentialUrl);
  const distinctScope = resolveTargetScope("custom", distinctUrl);
  const accountNames: string[] = [];

  createAuthCredentialStores({
    targetScope: scope,
    clientId: "cli-client",
    platform: "darwin",
    entryFactory: (serviceName, accountName) => {
      accountNames.push(`${serviceName}:${accountName}`);
      return {
        getPassword: () => null,
        setPassword: () => {},
        deletePassword: () => true,
      };
    },
  });

  const scopedUrl = Buffer.from(scope.replace(/^custom-/u, ""), "hex").toString(
    "utf8",
  );
  assert.equal(scopedUrl, "https://host/api?region=west");
  assert.notEqual(scope, distinctScope);
  assert.doesNotMatch(
    scopedUrl,
    /user|password|secret|bearer|private|auth|signature|jwt|fragment/i,
  );
  assert.ok(
    accountNames.every((accountName) =>
      accountName.startsWith(`sokosumi-cli:${scope}:`),
    ),
  );
});

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
test("fails closed when Linux Secret Service cannot connect over D-Bus", () => {
  const execFileSync = (): never => {
    const error = new Error("D-Bus session unavailable") as Error & {
      status: number;
      stderr: string;
    };
    error.status = 1;
    error.stderr = "secret-tool: Cannot connect to the D-Bus session bus";
    throw error;
  };
  const store = createCredentialStore({
    platform: "linux",
    execFileSync,
  });

  assert.equal(store.isSupported, false);
  assert.throws(() => store.write({ authToken: "secret" }), /credential vault/);
});

test("TestV65: keeps Linux Secret Service available when lookup returns status 1 with empty stderr", () => {
  const execFileSync = (): never => {
    const error = new Error("") as Error & {
      status: number;
      stderr: string;
    };
    error.status = 1;
    error.stderr = "";
    throw error;
  };
  const store = createCredentialStore({
    platform: "linux",
    execFileSync,
  });

  assert.equal(store.isSupported, true);
  assert.equal(store.read(), null);
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
