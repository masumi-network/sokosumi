import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CMO_CLIENT_ID_VARIABLE,
  planPreviewRedirectUris,
  registerCmoPreviewCallback,
} from "./cmo-preview-callback.ts";

const PREVIEW_BRANCH = {
  id: "br-preview",
  name: "preview/gh-99-pr-7",
  parent_id: "br-main",
  default: false,
  protected: false,
};
const PREVIEW_URL =
  "https://sokosumi-cmo-git-feat-x-masumi.preview.sokosumi.com";
const CALLBACK = `${PREVIEW_URL}/api/auth/callback/sokosumi`;
const PRODUCTION = "https://cmo.xyz/api/auth/callback/sokosumi";
const CONNECTION_URI =
  "postgresql://neondb_owner:secret@ep-preview-123.us-east-2.aws.neon.tech/neondb?sslmode=require";

describe("planPreviewRedirectUris", () => {
  it("adds the preview callback after the existing redirect URIs", () => {
    assert.deepEqual(
      planPreviewRedirectUris({
        branch: PREVIEW_BRANCH,
        previewUrl: PREVIEW_URL,
        redirectUris: [PRODUCTION],
      }),
      { callbackUrl: CALLBACK, redirectUris: [PRODUCTION, CALLBACK] },
    );
  });

  it("changes nothing when the callback is already listed", () => {
    assert.deepEqual(
      planPreviewRedirectUris({
        branch: PREVIEW_BRANCH,
        previewUrl: `${PREVIEW_URL}/`,
        redirectUris: [PRODUCTION, CALLBACK],
      }),
      { callbackUrl: CALLBACK, redirectUris: null },
    );
  });

  it("rejects a database target that is not a preview branch", () => {
    for (const branch of [
      { id: "br-main", name: "main", default: true, protected: true },
      { ...PREVIEW_BRANCH, protected: true },
      { ...PREVIEW_BRANCH, default: true },
      { ...PREVIEW_BRANCH, parent_id: undefined },
    ]) {
      assert.throws(
        () =>
          planPreviewRedirectUris({
            branch,
            previewUrl: PREVIEW_URL,
            redirectUris: [PRODUCTION],
          }),
        /Refusing|no parent/,
      );
    }
  });

  it("rejects a preview URL that is not a plain https origin", () => {
    for (const previewUrl of [
      "http://sokosumi-cmo-git-feat-x-masumi.preview.sokosumi.com",
      "https://*.preview.sokosumi.com",
      "https://sokosumi-cmo-abc123-masumi.preview.sokosumi.com",
      "not a url",
    ]) {
      assert.throws(() =>
        planPreviewRedirectUris({
          branch: PREVIEW_BRANCH,
          previewUrl,
          redirectUris: [],
        }),
      );
    }
  });
});

/** Fake Neon: branch search, connection URI, and SQL over HTTP. */
function neonStub({
  branches = [PREVIEW_BRANCH],
  clients = { "cmo-client": [PRODUCTION] } as Record<string, string[] | null>,
} = {}) {
  const calls: { host: string; path: string; body?: unknown }[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ host: url.host, path: url.pathname, body });
    if (url.pathname.endsWith("/branches")) {
      const search = url.searchParams.get("search") ?? "";
      return Response.json({
        branches: branches.filter((branch) => branch.name.includes(search)),
      });
    }
    if (url.pathname.endsWith("/connection_uri")) {
      assert.equal(url.searchParams.get("branch_id"), PREVIEW_BRANCH.id);
      return Response.json({ uri: CONNECTION_URI });
    }
    if (url.host === "api.us-east-2.aws.neon.tech" && url.pathname === "/sql") {
      const headers = new Headers(init.headers);
      assert.equal(headers.get("Neon-Connection-String"), CONNECTION_URI);
      const { query, params } = body as { query: string; params: string[] };
      const clientId = params[0];
      if (query.startsWith("SELECT")) {
        const uris = clients[clientId];
        return Response.json({
          rows:
            uris === undefined
              ? []
              : [{ redirectUris: uris && JSON.stringify(uris) }],
        });
      }
      clients[clientId] = JSON.parse(params[1]);
      return Response.json({ rows: [] });
    }
    throw new Error(`unexpected call ${url}`);
  };
  return { calls, clients, fetchImpl };
}

function register(
  stub: ReturnType<typeof neonStub>,
  env: Record<string, string> = {},
) {
  return registerCmoPreviewCallback({
    repoId: 99,
    pullNumber: 7,
    previewUrl: PREVIEW_URL,
    neonEnv: {
      NEON_API_KEY: "neon-key",
      NEON_PREVIEW_PROJECT_ID_MAINNET: "prj-mainnet",
      [CMO_CLIENT_ID_VARIABLE]: "cmo-client",
      ...env,
    },
    neonFetchImpl: stub.fetchImpl,
  });
}

describe("registerCmoPreviewCallback", () => {
  it("adds the callback to the client in the PR's preview branch", async () => {
    const stub = neonStub();
    assert.deepEqual(await register(stub), {
      kind: "added",
      callbackUrl: CALLBACK,
    });
    assert.deepEqual(stub.clients["cmo-client"], [PRODUCTION, CALLBACK]);
  });

  it("leaves exactly one entry when it runs again", async () => {
    const stub = neonStub();
    await register(stub);
    assert.deepEqual(await register(stub), {
      kind: "unchanged",
      callbackUrl: CALLBACK,
    });
    assert.deepEqual(stub.clients["cmo-client"], [PRODUCTION, CALLBACK]);
    const updates = stub.calls.filter((call) =>
      (call.body as { query?: string })?.query?.startsWith("UPDATE"),
    );
    assert.equal(updates.length, 1);
  });

  it("treats a null redirect URI list as empty", async () => {
    const stub = neonStub({ clients: { "cmo-client": null } });
    await register(stub);
    assert.deepEqual(stub.clients["cmo-client"], [CALLBACK]);
  });

  it("fails without inserting when the client is missing from the branch", async () => {
    const stub = neonStub({ clients: {} });
    await assert.rejects(
      register(stub),
      /CMO's OAuth client `cmo-client` is not in `preview\/gh-99-pr-7`.*\/deploy mainnet --reset-db/,
    );
    assert.deepEqual(stub.clients, {});
  });

  it("never connects to a branch the reset guard refuses", async () => {
    const stub = neonStub({
      branches: [{ ...PREVIEW_BRANCH, protected: true }],
    });
    await assert.rejects(register(stub), /Refusing/);
    assert.ok(
      stub.calls.every(
        (call) =>
          !call.path.endsWith("/connection_uri") && call.path !== "/sql",
      ),
    );
  });

  it("fails when the PR has no mainnet preview branch", async () => {
    const stub = neonStub({ branches: [] });
    await assert.rejects(
      register(stub),
      /No Neon branch `preview\/gh-99-pr-7`/,
    );
  });

  it("skips when the CMO client id is not configured", async () => {
    const stub = neonStub();
    assert.deepEqual(await register(stub, { [CMO_CLIENT_ID_VARIABLE]: "" }), {
      kind: "unconfigured",
    });
    assert.deepEqual(stub.calls, []);
  });

  it("keeps the request path and connection string out of its errors", async () => {
    const stub = neonStub();
    const failing: typeof fetch = async (input, init) => {
      if (String(input).includes("/sql")) {
        return Response.json(
          { message: 'relation "oauthClient" does not exist' },
          { status: 400 },
        );
      }
      return stub.fetchImpl(input, init);
    };
    await assert.rejects(
      registerCmoPreviewCallback({
        repoId: 99,
        pullNumber: 7,
        previewUrl: PREVIEW_URL,
        neonEnv: {
          NEON_API_KEY: "neon-key",
          NEON_PREVIEW_PROJECT_ID_MAINNET: "prj-mainnet",
          [CMO_CLIENT_ID_VARIABLE]: "cmo-client",
        },
        neonFetchImpl: failing,
      }),
      (error: Error) => {
        assert.match(error.message, /relation "oauthClient" does not exist/);
        assert.doesNotMatch(error.message, /secret|prj-mainnet|br-preview/);
        return true;
      },
    );
  });
});
