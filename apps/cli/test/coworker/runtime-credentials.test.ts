import assert from "node:assert/strict";
import test from "node:test";

import type { CredentialStore } from "../../src/auth/secure-store.js";
import {
  createRuntimeCredentialStore,
  parseRuntimeKeyInput,
  type RuntimeCredential,
  readRuntimeCredential,
  saveRuntimeCredential,
} from "../../src/coworker/runtime-credentials.js";

const COWORKER_ID = "cow-1";
const API_KEY = "coworker_runtime-fixture";

function fixture(initial: RuntimeCredential | null = null) {
  let value = initial;
  const calls = { reads: 0, writes: 0 };
  const store: CredentialStore<RuntimeCredential> = {
    isSupported: true,
    read: () => {
      calls.reads += 1;
      return value;
    },
    write: (credential) => {
      calls.writes += 1;
      value = credential;
    },
    clear: () => {
      value = null;
    },
  };
  return { store, calls };
}

function secretFreeFailure(action: () => unknown, expected: RegExp) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, expected);
    assert.equal(error.message.includes(API_KEY), false);
    assert.equal("cause" in error, false);
    return true;
  });
}

test("§V78 runtime vault entries isolate Coworkers in case-insensitive vaults", () => {
  const entries = new Map<string, string>();
  const scopes: string[][] = [];
  const ids = ["cow-A", "cow-a", "cow:a", "cow_a", "cow-é"];
  const stores = ids.map((id) =>
    createRuntimeCredentialStore(id, {
      platform: "darwin",
      entryFactory: (service, account) => {
        scopes.push([service, account]);
        const scope = `${service}:${account}`.toLowerCase();
        return {
          getPassword: () => entries.get(scope) ?? null,
          setPassword: (value) => {
            entries.set(scope, value);
          },
          deletePassword: () => entries.delete(scope),
        };
      },
    }),
  );
  stores.forEach((store, index) => {
    saveRuntimeCredential(ids[index], `${API_KEY}-${index}`, store);
  });
  assert.equal(entries.size, ids.length);
  stores.forEach((store, index) => {
    assert.equal(
      readRuntimeCredential(ids[index], store),
      `${API_KEY}-${index}`,
    );
    const [service, account] = scopes[index];
    assert.equal(service, "sokosumi-coworker-runtime");
    assert.match(account, /^preprod:[0-9a-f]+$/u);
    assert.equal(
      Buffer.from(account.slice(8), "hex").toString("utf8"),
      ids[index],
    );
  });
});

test("§V78 invalid Coworker IDs fail before creating or reading a vault entry", () => {
  const { store, calls } = fixture({ apiKey: API_KEY });
  let entries = 0;
  for (const id of ["", "cow 1", "cow\n1", "\ud800"]) {
    assert.throws(
      () =>
        createRuntimeCredentialStore(id, {
          platform: "darwin",
          entryFactory: () => {
            entries += 1;
            throw new Error("must not create an entry");
          },
        }),
      /Coworker ID is invalid/u,
    );
    assert.throws(
      () => readRuntimeCredential(id, store),
      /Coworker ID is invalid/u,
    );
    assert.throws(
      () => saveRuntimeCredential(id, API_KEY, store),
      /Coworker ID is invalid/u,
    );
  }
  assert.equal(entries, 0);
  assert.deepEqual(calls, { reads: 0, writes: 0 });
});

test("§V78 parses raw stdin and matching Coworker API-key CLI JSON", () => {
  assert.equal(parseRuntimeKeyInput(` ${API_KEY}\n`, COWORKER_ID), API_KEY);
  assert.equal(
    parseRuntimeKeyInput(
      JSON.stringify({
        coworkerId: COWORKER_ID,
        apiKey: { token: API_KEY },
      }),
      COWORKER_ID,
    ),
    API_KEY,
  );
});

test("§V81 rejects developer, empty, and whitespace-bearing stdin credentials", () => {
  for (const key of [
    "",
    "soko_preprod_developer",
    "oauth-token",
    "coworker_",
    "coworker_one two",
    "coworker_one\ntwo",
  ]) {
    assert.throws(() => parseRuntimeKeyInput(key, COWORKER_ID), /coworker_\*/u);
  }
  assert.throws(
    () =>
      parseRuntimeKeyInput(
        JSON.stringify({
          coworkerId: COWORKER_ID,
          apiKey: { token: `${API_KEY}\n` },
        }),
        COWORKER_ID,
      ),
    /without whitespace/u,
  );
});

test("§V78 rejects mismatched or malformed key JSON without exposing input", () => {
  secretFreeFailure(
    () =>
      parseRuntimeKeyInput(
        JSON.stringify({
          coworkerId: "other-coworker",
          apiKey: { token: API_KEY },
        }),
        COWORKER_ID,
      ),
    /different Coworker/u,
  );
  secretFreeFailure(
    () => parseRuntimeKeyInput(`{"token":"${API_KEY}"`, COWORKER_ID),
    /CLI JSON output/u,
  );
  for (const apiKey of [null, [], API_KEY, {}, { token: 123 }]) {
    secretFreeFailure(
      () =>
        parseRuntimeKeyInput(
          JSON.stringify({ coworkerId: COWORKER_ID, apiKey }),
          COWORKER_ID,
        ),
      /apiKey.token|coworker_\*/u,
    );
  }
});

test("§V78 bounds stdin by UTF-8 bytes at 16 KiB", () => {
  const exact = `coworker_${"a".repeat(16_384 - "coworker_".length)}`;
  assert.equal(parseRuntimeKeyInput(exact, COWORKER_ID), exact);
  assert.throws(
    () => parseRuntimeKeyInput(`${exact}a`, COWORKER_ID),
    /too large/u,
  );
  assert.throws(
    () => parseRuntimeKeyInput(`coworker_${"é".repeat(8192)}`, COWORKER_ID),
    /too large/u,
  );
});

test("§V78 read and save use only the injected runtime store without HTTP", (context) => {
  const { store, calls } = fixture();
  let requests = 0;
  context.mock.method(globalThis, "fetch", () => {
    requests += 1;
    throw new Error("must not request Core");
  });
  saveRuntimeCredential(COWORKER_ID, API_KEY, store);
  assert.equal(readRuntimeCredential(COWORKER_ID, store), API_KEY);
  assert.deepEqual(store.read(), { apiKey: API_KEY });
  assert.deepEqual(calls, { reads: 2, writes: 1 });
  assert.equal(requests, 0);
});

test("§V81 rejects invalid stored credentials and rejects invalid keys before writing", () => {
  for (const apiKey of [
    "",
    "soko_preprod_developer",
    "coworker_",
    "coworker_bad key",
  ]) {
    const { store, calls } = fixture({ apiKey });
    assert.throws(
      () => readRuntimeCredential(COWORKER_ID, store),
      /coworker_\*/u,
    );
    assert.throws(
      () => saveRuntimeCredential(COWORKER_ID, apiKey, store),
      /coworker_\*/u,
    );
    assert.deepEqual(calls, { reads: 1, writes: 0 });
  }
  for (const raw of ["{}", '{"apiKey":123}', "[]", '"unexpected"']) {
    const { store } = fixture(JSON.parse(raw));
    assert.throws(
      () => readRuntimeCredential(COWORKER_ID, store),
      /coworker_\*/u,
    );
  }
});

test("§V78 a missing runtime key gives an explicit stdin or import recovery path", () => {
  const { store } = fixture();
  assert.throws(
    () => readRuntimeCredential(COWORKER_ID, store),
    /runtime key-import or supply --api-key-stdin/u,
  );
});

test("§V78 unsupported vaults never read or write and direct operators to stdin", () => {
  const { store, calls } = fixture({ apiKey: API_KEY });
  const unsupported = { ...store, isSupported: false };
  secretFreeFailure(
    () => readRuntimeCredential(COWORKER_ID, unsupported),
    /--api-key-stdin/u,
  );
  secretFreeFailure(
    () => saveRuntimeCredential(COWORKER_ID, API_KEY, unsupported),
    /--api-key-stdin/u,
  );
  assert.deepEqual(calls, { reads: 0, writes: 0 });
});

test("§V78 vault failures discard secret-bearing errors at construction, read, and write", () => {
  const fail = () => {
    throw new Error(`Vault failure for ${API_KEY}`, { cause: API_KEY });
  };
  secretFreeFailure(
    () =>
      createRuntimeCredentialStore(COWORKER_ID, {
        platform: "darwin",
        entryFactory: fail,
      }),
    /--api-key-stdin/u,
  );
  const store: CredentialStore<RuntimeCredential> = {
    read: fail,
    write: fail,
    clear: () => {},
  };
  secretFreeFailure(
    () => readRuntimeCredential(COWORKER_ID, store),
    /--api-key-stdin/u,
  );
  secretFreeFailure(
    () => saveRuntimeCredential(COWORKER_ID, API_KEY, store),
    /--api-key-stdin/u,
  );
});
