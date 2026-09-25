import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import {
  readPreviewNeonConfigs,
  resetUsageMessage,
  runDeployWithResetComment,
  runPreviewDbResetComment,
  runResetDbJobComment,
  stripResetDbFlag,
} from "./preview-db-reset.mjs";
import { parseNetworkCommand, usageMessage } from "./vercel-deploy.mjs";

const PULL_REQUEST = {
  head: { sha: "deadbeef", ref: "feat/x", repo: { id: 99 } },
  base: { repo: { id: 99 } },
};

const NEON_ENV = {
  NEON_API_KEY: "neon-key",
  NEON_PREVIEW_PROJECT_ID_MAINNET: "prj-mainnet",
  NEON_PREVIEW_PROJECT_ID_PREPROD: "prj-preprod",
};

function previewBranch(projectId, overrides = {}) {
  return {
    id: `br-${projectId}`,
    name: "preview/feat/x",
    parent_id: `br-${projectId}-parent`,
    default: false,
    protected: false,
    ...overrides,
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => JSON.stringify(body),
  };
}

/** Fake Neon API: branch search, restore, and operation polling. */
function neonStub({
  branches = {},
  listStatus = {},
  restoreStatus = {},
  restoreError = {},
  operationStatus = {},
  operationHttpStatus = {},
  beforeOperation,
} = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const path = pathname.replace(/^\/api\/v2/, "");
    calls.push({
      method: init.method ?? "GET",
      path,
      auth: init.headers?.Authorization,
      signal: init.signal,
      search: searchParams.get("search"),
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const [, , projectId, kind, id, action] = path.split("/");
    if (kind === "branches" && id === undefined) {
      if (listStatus[projectId]) {
        return jsonResponse(listStatus[projectId], { message: "bad key" });
      }
      const search = searchParams.get("search") ?? "";
      return jsonResponse(200, {
        branches: (branches[projectId] ?? []).filter((branch) =>
          branch.name.includes(search),
        ),
      });
    }
    if (kind === "branches" && action === "restore") {
      if (restoreError[projectId]) {
        throw restoreError[projectId];
      }
      const status = restoreStatus[projectId] ?? 200;
      return status === 200
        ? jsonResponse(200, {
            branch: { id },
            operations: [{ id: `op-${projectId}`, status: "running" }],
          })
        : jsonResponse(status, { message: `restore failed ${status}.` });
    }
    if (kind === "operations") {
      await beforeOperation?.(projectId);
      if (operationHttpStatus[projectId]) {
        return jsonResponse(operationHttpStatus[projectId], {
          message: "no such operation",
        });
      }
      return jsonResponse(200, {
        operation: { id, status: operationStatus[projectId] ?? "finished" },
      });
    }
    throw new Error(`unexpected Neon call ${init.method ?? "GET"} ${path}`);
  };
  return { calls, fetchImpl };
}

function setup({
  commentBody = "/reset-db all",
  neon = {},
  ...overrides
} = {}) {
  const posted = [];
  const reactions = [];
  const created = [];
  const stub = neonStub({
    branches: {
      "prj-mainnet": [
        previewBranch("prj-mainnet"),
        previewBranch("prj-mainnet", {
          id: "br-decoy",
          name: "preview/feat/x-2",
        }),
      ],
      "prj-preprod": [previewBranch("prj-preprod")],
    },
    ...neon,
  });
  const options = {
    commentBody,
    isPullRequest: true,
    commentAuthor: "alice",
    repoId: 99,
    readPermission: async () => "write",
    readPullRequest: async () => PULL_REQUEST,
    neonEnv: NEON_ENV,
    neonFetchImpl: stub.fetchImpl,
    sleep: async () => {},
    createDeployment: async (input) => {
      created.push(input);
      return { id: `dpl_${input.target.name}`, readyState: "READY" };
    },
    pollDeployment: async (deployment) => deployment,
    postComment: async (body) => {
      posted.push(body);
    },
    addReaction: async (content) => {
      reactions.push(content);
    },
    ...overrides,
  };
  return { options, posted, reactions, created, neonCalls: stub.calls };
}

function restoreCalls(neonCalls) {
  return neonCalls.filter((call) => call.path.endsWith("/restore"));
}

describe("parseNetworkCommand for /reset-db", () => {
  it("parses networks and ignores other commands", () => {
    assert.deepEqual(parseNetworkCommand("/reset-db all", "/reset-db"), {
      kind: "run",
      networks: ["mainnet", "preprod"],
    });
    assert.deepEqual(parseNetworkCommand("/reset-db preprod", "/reset-db"), {
      kind: "run",
      networks: ["preprod"],
    });
    assert.deepEqual(parseNetworkCommand("/reset-db", "/reset-db"), {
      kind: "usage",
    });
    assert.deepEqual(parseNetworkCommand("/deploy mainnet", "/reset-db"), {
      kind: "ignore",
    });
    assert.deepEqual(parseNetworkCommand("/reset-db-mainnet", "/reset-db"), {
      kind: "ignore",
    });
  });
});

describe("readPreviewNeonConfigs", () => {
  it("returns one config per requested network, with the org key", () => {
    assert.deepEqual(readPreviewNeonConfigs(NEON_ENV, ["mainnet", "preprod"]), [
      {
        network: "mainnet",
        config: { apiKey: "neon-key", projectId: "prj-mainnet" },
      },
      {
        network: "preprod",
        config: { apiKey: "neon-key", projectId: "prj-preprod" },
      },
    ]);
  });

  it("fails without the Neon key or a requested network's project id", () => {
    assert.throws(
      () => readPreviewNeonConfigs({}, ["mainnet"]),
      /^Error: NEON_API_KEY is not set$/,
    );
    assert.throws(
      () => readPreviewNeonConfigs({ NEON_API_KEY: "neon-key" }, ["mainnet"]),
      /^Error: NEON_PREVIEW_PROJECT_ID_MAINNET is not set$/,
    );
    assert.throws(
      () =>
        readPreviewNeonConfigs({ ...NEON_ENV, NEON_API_KEY: " " }, ["mainnet"]),
      /NEON_API_KEY is not set/,
    );
  });
});

describe("runPreviewDbResetComment", () => {
  it("ignores comments that are not /reset-db", async () => {
    const { options, posted, neonCalls } = setup({
      commentBody: "/deploy mainnet",
    });
    assert.deepEqual(await runPreviewDbResetComment(options), {
      kind: "ignore",
    });
    assert.deepEqual(posted, []);
    assert.deepEqual(neonCalls, []);
  });

  it("refuses commenters without write access", async () => {
    const { options, posted, neonCalls } = setup({
      readPermission: async () => "read",
    });
    assert.deepEqual(await runPreviewDbResetComment(options), {
      kind: "denied",
    });
    assert.deepEqual(posted, [
      "Only people with write access to this repository can reset preview databases.",
    ]);
    assert.deepEqual(neonCalls, []);
  });

  it("replies with usage for a bare /reset-db", async () => {
    const { options, posted } = setup({ commentBody: "/reset-db" });
    assert.deepEqual(await runPreviewDbResetComment(options), {
      kind: "usage",
    });
    assert.deepEqual(posted, [resetUsageMessage()]);
  });

  it("refuses fork pull requests", async () => {
    const { options, posted, neonCalls } = setup({
      readPullRequest: async () => ({
        ...PULL_REQUEST,
        head: { ...PULL_REQUEST.head, repo: { id: 2 } },
      }),
    });
    assert.deepEqual(await runPreviewDbResetComment(options), {
      kind: "fork",
    });
    assert.deepEqual(posted, [
      "`/reset-db` is only available for branches in this repository, not forks.",
    ]);
    assert.deepEqual(neonCalls, []);
  });

  it("waits between operation polls with the given sleep", async () => {
    const slept = [];
    const { options } = setup({
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    await runPreviewDbResetComment(options);
    assert.deepEqual(slept, [5000, 5000]);
  });

  it("resets each network's exact preview branch, then redeploys Core only", async (t) => {
    const timeout = t.mock.method(AbortSignal, "timeout");
    const { options, posted, reactions, created, neonCalls } = setup();
    const result = await runPreviewDbResetComment(options);

    assert.equal(result.kind, "reset");
    assert.equal(result.branchName, "preview/feat/x");
    assert.deepEqual(
      neonCalls
        .filter((call) => call.path.endsWith("/branches"))
        .map((call) => call.search),
      ["preview/feat/x", "preview/feat/x"],
    );
    assert.deepEqual(
      restoreCalls(neonCalls).map((call) => [call.path, call.body]),
      [
        [
          "/projects/prj-mainnet/branches/br-prj-mainnet/restore",
          { source_branch_id: "br-prj-mainnet-parent" },
        ],
        [
          "/projects/prj-preprod/branches/br-prj-preprod/restore",
          { source_branch_id: "br-prj-preprod-parent" },
        ],
      ],
    );
    assert.deepEqual(
      neonCalls
        .filter((call) => call.path.includes("/operations/"))
        .map((call) => call.path),
      [
        "/projects/prj-mainnet/operations/op-prj-mainnet",
        "/projects/prj-preprod/operations/op-prj-preprod",
      ],
    );
    for (const call of neonCalls) {
      assert.equal(call.auth, "Bearer neon-key", call.path);
    }
    // Each Neon request gets its own 30-second limit. The workflow's
    // timeout-minutes counts on it.
    assert.deepEqual(
      timeout.mock.calls.map((call) => call.arguments),
      neonCalls.map(() => [30_000]),
    );
    assert.deepEqual(
      neonCalls.map((call) => call.signal),
      timeout.mock.calls.map((call) => call.result),
    );
    assert.deepEqual(
      created.map((input) => [input.target.name, input.ref, input.sha]),
      [
        ["sokosumi-core-mainnet", "feat/x", "deadbeef"],
        ["sokosumi-core-preprod", "feat/x", "deadbeef"],
      ],
    );
    assert.deepEqual(posted, [
      "Reset `preview/feat/x` to its parent on mainnet, preprod and redeployed Core. The Core build ran `prisma migrate deploy` on the clean branch.",
    ]);
    assert.deepEqual(reactions, ["eyes", "rocket"]);
  });

  it("waits for the Neon operation to finish before it redeploys Core", async () => {
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    let markPolled;
    const polled = new Promise((resolve) => {
      markPolled = resolve;
    });
    const { options, created } = setup({
      commentBody: "/reset-db mainnet",
      neon: {
        beforeOperation: async () => {
          markPolled();
          await held;
        },
      },
    });

    const run = runPreviewDbResetComment(options);
    await Promise.race([polled, run]);
    assert.deepEqual(created, []);
    release();
    await run;
    assert.deepEqual(
      created.map((input) => input.target.name),
      ["sokosumi-core-mainnet"],
    );
  });

  it("resets nothing when the Neon key is missing", async () => {
    const { NEON_API_KEY: _unset, ...neonEnv } = NEON_ENV;
    const { options, posted, reactions, created, neonCalls } = setup({
      neonEnv,
    });
    await assert.rejects(
      () => runPreviewDbResetComment(options),
      /NEON_API_KEY is not set/,
    );
    assert.deepEqual(neonCalls, []);
    assert.deepEqual(created, []);
    assert.deepEqual(posted, [
      "`/reset-db` failed: NEON_API_KEY is not set. Nothing was reset.",
    ]);
    assert.deepEqual(reactions, ["eyes"]);
  });

  it("resets nothing when a requested network has no project id", async () => {
    const { NEON_PREVIEW_PROJECT_ID_PREPROD: _unset, ...neonEnv } = NEON_ENV;
    const { options, posted, neonCalls } = setup({ neonEnv });
    await assert.rejects(
      () => runPreviewDbResetComment(options),
      /NEON_PREVIEW_PROJECT_ID_PREPROD is not set/,
    );
    assert.deepEqual(neonCalls, []);
    assert.deepEqual(posted, [
      "`/reset-db` failed: NEON_PREVIEW_PROJECT_ID_PREPROD is not set. Nothing was reset.",
    ]);
  });

  it("names the network whose branch lookup fails", async () => {
    const { options, posted, neonCalls } = setup({
      neon: { listStatus: { "prj-preprod": 401 } },
    });
    await assert.rejects(
      () => runPreviewDbResetComment(options),
      /Neon answered 401/,
    );
    assert.deepEqual(restoreCalls(neonCalls), []);
    // The reply is public, so it leaves out the request path with its ids.
    assert.deepEqual(posted, [
      "`/reset-db` failed: preprod: the branch lookup failed: Neon answered 401: bad key. Nothing was reset.",
    ]);
  });

  it("resets nothing when one network has no branch with the exact name", async () => {
    const { options, posted, created, neonCalls } = setup({
      neon: {
        branches: {
          "prj-mainnet": [previewBranch("prj-mainnet")],
          "prj-preprod": [
            previewBranch("prj-preprod", { name: "preview/feat/x-2" }),
          ],
        },
      },
    });
    await assert.rejects(
      () => runPreviewDbResetComment(options),
      /preprod: No Neon branch `preview\/feat\/x` in the preview project/,
    );
    assert.deepEqual(restoreCalls(neonCalls), []);
    assert.deepEqual(created, []);
    assert.deepEqual(posted, [
      "`/reset-db` failed: preprod: No Neon branch `preview/feat/x` in the preview project. A Core preview deployment of this branch creates it. Nothing was reset.",
    ]);
  });

  it("refuses a protected branch on any network before it restores one", async () => {
    const { options, posted, neonCalls } = setup({
      neon: {
        branches: {
          "prj-mainnet": [previewBranch("prj-mainnet")],
          "prj-preprod": [previewBranch("prj-preprod", { protected: true })],
        },
      },
    });
    await assert.rejects(
      () => runPreviewDbResetComment(options),
      /Refusing to reset protected\/default branch "preview\/feat\/x"/,
    );
    assert.deepEqual(restoreCalls(neonCalls), []);
    assert.deepEqual(posted, [
      '`/reset-db` failed: preprod: Refusing to reset protected/default branch "preview/feat/x". Nothing was reset.',
    ]);
  });

  it("names the networks that were reset when a later restore fails", async () => {
    const { options, posted, created } = setup({
      neon: { restoreStatus: { "prj-preprod": 409 } },
    });
    await assert.rejects(
      () => runPreviewDbResetComment(options),
      /was reset on mainnet without a Core redeploy/,
    );
    assert.deepEqual(created, []);
    assert.deepEqual(posted, [
      "`/reset-db` failed: preprod: the restore failed: Neon answered 409: restore failed 409. `preview/feat/x` was reset on mainnet without a Core redeploy. Comment `/deploy mainnet` to run the migrations. Neon refused the reset on preprod. Comment `/reset-db preprod` once the cause is fixed.",
    ]);
  });

  it("says nothing was reset when Neon refuses the first restore", async () => {
    // A lock, a rate limit, or a 503 also means that Neon did not act, but it
    // clears by itself, so the reply says to try again.
    const refused = "Neon refused the reset on mainnet.";
    const busy = "Neon was busy and did not reset mainnet.";
    for (const [commentBody, status, retry, restores, reason, advice] of [
      [
        "/reset-db mainnet",
        409,
        "mainnet",
        1,
        refused,
        "once the cause is fixed",
      ],
      ["/reset-db mainnet", 429, "mainnet", 1, busy, "to try again"],
      ["/reset-db mainnet", 423, "mainnet", 5, busy, "to try again"],
      ["/reset-db mainnet", 503, "mainnet", 1, busy, "to try again"],
      [
        "/reset-db all",
        409,
        "mainnet preprod",
        1,
        refused,
        "once the cause is fixed",
      ],
    ]) {
      const { options, posted, neonCalls } = setup({
        commentBody,
        neon: { restoreStatus: { "prj-mainnet": status } },
      });
      await assert.rejects(
        () => runPreviewDbResetComment(options),
        new RegExp(`Neon answered ${status}`),
      );
      assert.deepEqual(
        restoreCalls(neonCalls).map((call) => call.path),
        Array(restores).fill(
          "/projects/prj-mainnet/branches/br-prj-mainnet/restore",
        ),
      );
      assert.deepEqual(posted, [
        `\`/reset-db\` failed: mainnet: the restore failed: Neon answered ${status}: restore failed ${status}. ${reason} Nothing was reset. Comment \`/reset-db ${retry}\` ${advice}.`,
      ]);
    }
  });

  it("asks for another reset of a network whose Neon operation failed", async () => {
    const { options, posted, created } = setup({
      neon: { operationStatus: { "prj-preprod": "failed" } },
    });
    await assert.rejects(
      () => runPreviewDbResetComment(options),
      /op-prj-preprod ended failed/,
    );
    assert.deepEqual(created, []);
    assert.deepEqual(posted, [
      "`/reset-db` failed: preprod: waiting for the restore failed: Neon operation op-prj-preprod ended failed. `preview/feat/x` was reset on mainnet without a Core redeploy. Comment `/deploy mainnet` to run the migrations. The reset on preprod may not have finished. Comment `/reset-db preprod` to try again.",
    ]);
  });

  it("asks for another reset when a poll fails after Neon accepted the restore", async () => {
    const { options, posted, created } = setup({
      commentBody: "/reset-db mainnet",
      neon: { operationHttpStatus: { "prj-mainnet": 404 } },
    });
    await assert.rejects(() => runPreviewDbResetComment(options), /404/);
    assert.deepEqual(created, []);
    assert.deepEqual(posted, [
      "`/reset-db` failed: mainnet: waiting for the restore failed: Neon answered 404: no such operation. The reset on mainnet may not have finished. Comment `/reset-db mainnet` to try again.",
    ]);
  });

  it("asks for another reset when a restore request may have reached Neon", async () => {
    for (const [neon, reason] of [
      [
        { restoreError: { "prj-mainnet": new TypeError("fetch failed") } },
        "the restore failed: fetch failed.",
      ],
      [
        { restoreStatus: { "prj-mainnet": 502 } },
        "the restore failed: Neon answered 502: restore failed 502.",
      ],
    ]) {
      const { options, posted, created } = setup({
        commentBody: "/reset-db mainnet",
        neon,
      });
      await assert.rejects(() => runPreviewDbResetComment(options));
      assert.deepEqual(created, []);
      assert.deepEqual(posted, [
        `\`/reset-db\` failed: mainnet: ${reason} The reset on mainnet may not have finished. Comment \`/reset-db mainnet\` to try again.`,
      ]);
    }
  });

  it("names the networks that did not start after an unfinished reset", async () => {
    const { options, posted, created, neonCalls } = setup({
      neon: {
        restoreError: { "prj-mainnet": new TypeError("fetch failed") },
      },
    });
    await assert.rejects(() => runPreviewDbResetComment(options));
    assert.deepEqual(
      restoreCalls(neonCalls).map((call) => call.path),
      ["/projects/prj-mainnet/branches/br-prj-mainnet/restore"],
    );
    assert.deepEqual(created, []);
    assert.deepEqual(posted, [
      "`/reset-db` failed: mainnet: the restore failed: fetch failed. The reset on mainnet may not have finished. The reset on preprod did not start. Comment `/reset-db mainnet preprod` to try again.",
    ]);
  });

  it("keeps the success reply when the rocket reaction fails", async (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    const { options, posted } = setup({
      commentBody: "/reset-db mainnet",
      addReaction: async (content) => {
        if (content === "rocket") {
          throw new Error("GitHub 502: {}");
        }
      },
    });
    const result = await runPreviewDbResetComment(options);
    assert.equal(result.kind, "reset");
    assert.deepEqual(posted, [
      "Reset `preview/feat/x` to its parent on mainnet and redeployed Core. The Core build ran `prisma migrate deploy` on the clean branch.",
    ]);
    assert.equal(warn.mock.callCount(), 1);
  });

  it("does not reply failed when only the success reply fails", async (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    const { options, reactions } = setup({
      commentBody: "/reset-db mainnet",
      postComment: async () => {
        throw new Error("GitHub 502: {}");
      },
    });
    const result = await runPreviewDbResetComment(options);
    assert.equal(result.kind, "reset");
    assert.deepEqual(reactions, ["eyes", "rocket"]);
    assert.deepEqual(
      warn.mock.calls.map((call) => call.arguments),
      [["Success reply failed: GitHub 502: {}."]],
    );
  });

  it("says the reset happened when the Core redeploy fails", async () => {
    const { options, posted, reactions } = setup({
      commentBody: "/reset-db mainnet",
      createDeployment: async (input) => ({
        id: `dpl_${input.target.name}`,
        readyState: "ERROR",
      }),
    });
    await assert.rejects(
      () => runPreviewDbResetComment(options),
      /but the Core redeploy failed: sokosumi-core-mainnet \(ERROR\)/,
    );
    assert.deepEqual(posted, [
      "`/reset-db` failed: `preview/feat/x` was reset on mainnet, but the Core redeploy failed: sokosumi-core-mainnet (ERROR). If `prisma migrate deploy` failed in the build log, fix the migration first. Then comment `/deploy mainnet` to run the migrations.",
    ]);
    assert.deepEqual(reactions, ["eyes"]);
  });

  it("names only the networks whose Core build failed in the /deploy advice", async () => {
    const { options, posted } = setup({
      commentBody: "/reset-db all",
      createDeployment: async (input) => ({
        id: `dpl_${input.target.name}`,
        readyState: input.target.network === "preprod" ? "ERROR" : "READY",
      }),
    });
    await assert.rejects(() => runPreviewDbResetComment(options));
    assert.deepEqual(posted, [
      "`/reset-db` failed: `preview/feat/x` was reset on mainnet, preprod, but the Core redeploy failed: sokosumi-core-preprod (ERROR). If `prisma migrate deploy` failed in the build log, fix the migration first. Then comment `/deploy preprod` to run the migrations.",
    ]);
  });

  it("names every reset network when the Vercel request fails", async () => {
    const { options, posted } = setup({
      commentBody: "/reset-db all",
      createDeployment: async () => {
        throw new Error("Vercel 500");
      },
    });
    await assert.rejects(() => runPreviewDbResetComment(options));
    assert.equal(posted.length, 1);
    assert.match(
      posted[0],
      /^`\/reset-db` failed: `preview\/feat\/x` was reset on mainnet, preprod, but the Core redeploy failed: Vercel 500\. .* Then comment `\/deploy mainnet preprod` to run the migrations\.$/,
    );
  });
});

describe("stripResetDbFlag", () => {
  it("drops the flag from a /deploy first line and ignores other comments", () => {
    for (const [body, expected] of [
      ["/deploy all --reset-db", "/deploy all"],
      ["/deploy --reset-db preprod", "/deploy preprod"],
      ["/deploy --reset-db", "/deploy"],
      ["  /DEPLOY mainnet --RESET-DB\nsee above", "/DEPLOY mainnet"],
      ["\uFEFF/deploy all --reset-db", "/deploy all"],
      ["/deploy all", null],
      ["/deploy all\n--reset-db", null],
      ["/deploy all --reset-dbx", null],
      ["/reset-db all --reset-db", null],
      ["please /deploy all --reset-db", null],
      ["", null],
      [undefined, null],
    ]) {
      assert.equal(stripResetDbFlag(body), expected, JSON.stringify(body));
    }
  });
});

describe("runDeployWithResetComment", () => {
  function deployReset(overrides = {}) {
    return setup({
      commentBody: "/deploy all --reset-db",
      listFiles: async () => [{ filename: "apps/core/src/index.ts" }],
      ...overrides,
    });
  }

  it("resets each network's preview branch, then deploys web and Core", async () => {
    const { options, posted, reactions, created, neonCalls } = deployReset();
    const result = await runDeployWithResetComment(options);

    assert.equal(result.kind, "reset");
    assert.deepEqual(
      restoreCalls(neonCalls).map((call) => call.path),
      [
        "/projects/prj-mainnet/branches/br-prj-mainnet/restore",
        "/projects/prj-preprod/branches/br-prj-preprod/restore",
      ],
    );
    assert.deepEqual(
      created.map((input) => [input.target.network, input.target.app]),
      [
        ["mainnet", "web"],
        ["mainnet", "core"],
        ["preprod", "web"],
        ["preprod", "core"],
      ],
    );
    assert.deepEqual(posted, [
      "Reset `preview/feat/x` to its parent on mainnet, preprod and deployed web and Core. The Core build ran `prisma migrate deploy` on the clean branch.",
    ]);
    assert.deepEqual(reactions, ["eyes", "rocket"]);
  });

  it("resets only the named network", async () => {
    const { options, created, neonCalls } = deployReset({
      commentBody: "/deploy preprod --reset-db",
    });
    await runDeployWithResetComment(options);
    assert.deepEqual(
      restoreCalls(neonCalls).map((call) => call.path),
      ["/projects/prj-preprod/branches/br-prj-preprod/restore"],
    );
    assert.deepEqual(
      created.map((input) => input.target.network),
      ["preprod", "preprod"],
    );
  });

  it("replies with the /deploy usage when no network is named", async () => {
    const { options, posted, neonCalls } = deployReset({
      commentBody: "/deploy --reset-db",
    });
    const result = await runDeployWithResetComment(options);
    assert.equal(result.kind, "usage");
    assert.deepEqual(posted, [usageMessage()]);
    assert.match(posted[0], /`--reset-db` on the first line/);
    assert.deepEqual(neonCalls, []);
  });

  it("gives the /deploy form in the retry advice", async () => {
    const { options, posted, created } = deployReset({
      neon: { restoreStatus: { "prj-preprod": 409 } },
    });
    await assert.rejects(() => runDeployWithResetComment(options));
    assert.deepEqual(created, []);
    assert.deepEqual(posted, [
      "Preview deploy failed: preprod: the restore failed: Neon answered 409: restore failed 409. `preview/feat/x` was reset on mainnet without a web and Core deploy. Comment `/deploy mainnet` to run the migrations. Neon refused the reset on preprod. Comment `/deploy preprod --reset-db` once the cause is fixed.",
    ]);
  });

  it("says the reset happened when the web and Core deploy fails", async () => {
    for (const [failedApp, next] of [
      [
        "web",
        "Core ran the migrations. Comment `/deploy mainnet` to deploy again.",
      ],
      [
        "core",
        "If `prisma migrate deploy` failed in the build log, fix the migration first. Then comment `/deploy mainnet` to run the migrations.",
      ],
    ]) {
      const { options, posted } = deployReset({
        commentBody: "/deploy mainnet --reset-db",
        createDeployment: async (input) => ({
          id: `dpl_${input.target.name}`,
          readyState: input.target.app === failedApp ? "ERROR" : "READY",
        }),
      });
      await assert.rejects(() => runDeployWithResetComment(options));
      assert.equal(posted.length, 1);
      const prefix =
        "Preview deploy failed: `preview/feat/x` was reset on mainnet, but the web and Core deploy failed: ";
      assert.ok(posted[0].startsWith(prefix), posted[0]);
      assert.match(posted[0].slice(prefix.length), /^\S+ \(ERROR\)\. /);
      assert.ok(posted[0].endsWith(` (ERROR). ${next}`), posted[0]);
    }
  });

  it("names only the failed networks, and gives the migrate advice when any Core failed", async () => {
    for (const [failing, next] of [
      [
        ["preprod/web"],
        "Core ran the migrations. Comment `/deploy preprod` to deploy again.",
      ],
      [
        ["mainnet/web", "preprod/core"],
        "If `prisma migrate deploy` failed in the build log, fix the migration first. Then comment `/deploy mainnet preprod` to run the migrations.",
      ],
    ]) {
      const { options, posted } = deployReset({
        createDeployment: async (input) => ({
          id: `dpl_${input.target.name}`,
          readyState: failing.includes(
            `${input.target.network}/${input.target.app}`,
          )
            ? "ERROR"
            : "READY",
        }),
      });
      await assert.rejects(() => runDeployWithResetComment(options));
      assert.equal(posted.length, 1);
      assert.ok(
        posted[0].startsWith(
          "Preview deploy failed: `preview/feat/x` was reset on mainnet, preprod, but the web and Core deploy failed: ",
        ),
        posted[0],
      );
      assert.ok(posted[0].endsWith(` (ERROR). ${next}`), posted[0]);
    }
  });

  it("runs a plain /deploy when the flag is not on the first line", async () => {
    const { options, posted, reactions, created, neonCalls } = deployReset({
      commentBody: "/deploy mainnet\nno --reset-db this time",
    });
    const result = await runDeployWithResetComment(options);
    assert.equal(result.kind, "deploy");
    assert.deepEqual(neonCalls, []);
    assert.deepEqual(
      created.map((input) => input.target.app),
      ["web", "core"],
    );
    assert.deepEqual(posted, []);
    assert.deepEqual(reactions, ["eyes", "rocket"]);
  });
});

describe("runResetDbJobComment", () => {
  it("sends /deploy comments to the deploy flow and the rest to /reset-db", async () => {
    for (const [commentBody, restores, apps] of [
      ["/deploy mainnet --reset-db", 1, ["web", "core"]],
      ["/deploy mainnet\n--reset-db", 0, ["web", "core"]],
      ["/reset-db mainnet", 1, ["core"]],
    ]) {
      const { options, created, neonCalls } = setup({
        commentBody,
        listFiles: async () => [{ filename: "apps/core/src/index.ts" }],
      });
      await runResetDbJobComment(options);
      assert.equal(restoreCalls(neonCalls).length, restores, commentBody);
      assert.deepEqual(
        created.map((input) => input.target.app),
        apps,
        commentBody,
      );
    }
  });
});

describe("the /reset-db script", () => {
  // The workflow runs the file itself. If it stopped running as a script, the
  // job would pass without a reply.
  it("runs the command when started as a script", () => {
    const run = spawnSync(
      process.execPath,
      [new URL("./preview-db-reset.mjs", import.meta.url).pathname],
      { env: { PATH: process.env.PATH }, encoding: "utf8" },
    );
    assert.equal(run.status, 1);
    assert.match(run.stderr, /VERCEL_TOKEN is required/);
  });

  // The job starts the script for `/deploy --reset-db` too, so the script
  // must route those comments to the deploy flow.
  it("runs /deploy --reset-db comments when started as a script", (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "reset-db-cli-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const eventPath = path.join(dir, "event.json");
    writeFileSync(
      eventPath,
      JSON.stringify({
        comment: {
          body: "/deploy mainnet --reset-db",
          user: { login: "alice" },
          id: 1,
        },
        issue: { number: 7, pull_request: {} },
        repository: { id: 99 },
      }),
    );
    // Answers GitHub and prints each posted comment. Neon is never reached,
    // because the Neon variables are unset.
    const stubPath = path.join(dir, "fetch-stub.mjs");
    writeFileSync(
      stubPath,
      `const pullRequest = ${JSON.stringify(PULL_REQUEST)};
globalThis.fetch = async (url, init = {}) => {
  const json = (body) => new Response(JSON.stringify(body), { status: 200 });
  if (url.endsWith("/permission")) return json({ permission: "write" });
  if (url.endsWith("/pulls/7")) return json(pullRequest);
  if (url.endsWith("/issues/7/comments")) {
    console.log("COMMENT " + JSON.parse(init.body).body);
  }
  return json({});
};
`,
    );
    const run = spawnSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(stubPath).href,
        new URL("./preview-db-reset.mjs", import.meta.url).pathname,
      ],
      {
        env: {
          PATH: process.env.PATH,
          VERCEL_TOKEN: "vercel-token",
          GITHUB_TOKEN: "github-token",
          GITHUB_REPOSITORY: "owner/repo",
          GITHUB_EVENT_PATH: eventPath,
        },
        encoding: "utf8",
      },
    );
    assert.equal(run.status, 1, run.stderr);
    assert.match(
      run.stdout,
      /^COMMENT Preview deploy failed: NEON_API_KEY is not set\. Nothing was reset\.$/m,
    );
  });
});
