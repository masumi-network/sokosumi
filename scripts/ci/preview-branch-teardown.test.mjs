import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runPreviewTeardown } from "./preview-branch-teardown.mjs";
import { VERCEL_PROJECTS } from "./vercel-deploy.mjs";

const REPO = "masumi-network/sokosumi";
const ENV = {
  GITHUB_REPOSITORY: REPO,
  GH_TOKEN: "gh-token",
  HEAD_REF: "feat/x",
  HEAD_REPO: REPO,
  NEON_API_KEY: "neon-key",
  NEON_PREVIEW_PROJECT_ID_MAINNET: "prj-mainnet",
  NEON_PREVIEW_PROJECT_ID_PREPROD: "prj-preprod",
  VERCEL_TOKEN: "vercel-token",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function fakeFetch({
  openPulls = [],
  branches = (project) => [
    { id: `${project}-y`, name: "preview/feat/xy" },
    { id: `${project}-x`, name: "preview/feat/x" },
  ],
  deleteStatus = 200,
  deleteStatuses = [],
  previews = (projectId) => [
    { uid: `dpl-${projectId}`, meta: { githubCommitRef: "feat/x" } },
  ],
  vercelListStatus = 200,
} = {}) {
  const calls = { deleted: [], githubUrls: [], vercelDeleted: [] };
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("https://api.vercel.com/")) {
      const parsed = new URL(url);
      if (init.method === "DELETE") {
        calls.vercelDeleted.push(parsed.pathname.split("/").at(-1));
        return json({ state: "DELETED" });
      }
      const projectId = parsed.searchParams.get("projectId");
      return json(
        { deployments: previews(projectId), pagination: { next: null } },
        vercelListStatus,
      );
    }
    if (url.startsWith("https://api.github.com/")) {
      calls.githubUrls.push(url);
      return json(openPulls);
    }
    const project = url.match(/projects\/([^/]+)\//)[1];
    if (init.method === "DELETE") {
      calls.deleted.push(url.split("/").at(-1));
      return json({}, deleteStatuses.shift() ?? deleteStatus);
    }
    return json({ branches: branches(project) });
  };
  return { fetchImpl, calls };
}

const quiet = () => {};

describe("runPreviewTeardown", () => {
  it("deletes only the closed PR's own branch in every preview project", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const ok = await runPreviewTeardown({ env: ENV, fetchImpl, log: quiet });
    assert.equal(ok, true);
    assert.deepEqual(calls.deleted, ["prj-mainnet-x", "prj-preprod-x"]);
    const query = new URL(calls.githubUrls[0]).searchParams;
    assert.equal(query.get("state"), "open");
    assert.equal(query.get("head"), "masumi-network:feat/x");
  });

  it("deletes the ref's Vercel previews in all four projects", async () => {
    const { fetchImpl, calls } = fakeFetch();
    assert.equal(
      await runPreviewTeardown({ env: ENV, fetchImpl, log: quiet }),
      true,
    );
    const projectIds = Object.values(VERCEL_PROJECTS).flatMap((apps) =>
      Object.values(apps).map(({ id }) => `dpl-${id}`),
    );
    assert.equal(projectIds.length, 4);
    assert.deepEqual(calls.vercelDeleted.sort(), projectIds.sort());
  });

  it("still deletes the Neon branches when Vercel fails, and reports it", async () => {
    const { fetchImpl, calls } = fakeFetch({ vercelListStatus: 500 });
    assert.equal(
      await runPreviewTeardown({ env: ENV, fetchImpl, log: quiet }),
      false,
    );
    assert.deepEqual(calls.deleted, ["prj-mainnet-x", "prj-preprod-x"]);
  });

  it("fails when the Neon lookup answers 404 (wrong project id)", async () => {
    const calls = [];
    const fetchImpl = async (input, init = {}) => {
      const url = String(input);
      calls.push(init.method ?? "GET");
      if (url.startsWith("https://api.github.com/")) return json([]);
      if (url.startsWith("https://api.vercel.com/")) {
        return json({ deployments: [], pagination: { next: null } });
      }
      return json({ message: "project not found" }, 404);
    };
    assert.equal(
      await runPreviewTeardown({ env: ENV, fetchImpl, log: quiet }),
      false,
    );
    assert.ok(!calls.includes("DELETE"));
  });

  it("throws before any call when a Neon setting is missing", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const env = { ...ENV, NEON_API_KEY: "" };
    await assert.rejects(
      runPreviewTeardown({ env, fetchImpl, log: quiet }),
      /NEON_API_KEY/,
    );
    assert.deepEqual(calls.githubUrls, []);
    assert.deepEqual(calls.vercelDeleted, []);
  });

  it("throws before any call when VERCEL_TOKEN is missing", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const env = { ...ENV, VERCEL_TOKEN: "" };
    await assert.rejects(
      runPreviewTeardown({ env, fetchImpl, log: quiet }),
      /VERCEL_TOKEN is not set/,
    );
    assert.deepEqual(calls.githubUrls, []);
  });

  it("keeps the branch while another open PR uses the ref", async () => {
    const { fetchImpl, calls } = fakeFetch({ openPulls: [{ number: 2 }] });
    assert.equal(
      await runPreviewTeardown({ env: ENV, fetchImpl, log: quiet }),
      true,
    );
    assert.deepEqual(calls.deleted, []);
    assert.deepEqual(calls.vercelDeleted, []);
  });

  it("skips the default branch without calling any API", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const env = { ...ENV, HEAD_REF: "main", DEFAULT_BRANCH: "main" };
    assert.equal(
      await runPreviewTeardown({ env, fetchImpl, log: quiet }),
      true,
    );
    assert.deepEqual(calls.githubUrls, []);
    assert.deepEqual(calls.vercelDeleted, []);
  });

  it("skips a fork head without calling any API", async () => {
    const { fetchImpl, calls } = fakeFetch();
    const env = { ...ENV, HEAD_REPO: "someone/fork" };
    assert.equal(
      await runPreviewTeardown({ env, fetchImpl, log: quiet }),
      true,
    );
    assert.deepEqual(calls.githubUrls, []);
    assert.deepEqual(calls.deleted, []);
  });

  for (const flag of ["protected", "default"]) {
    it(`refuses a ${flag} branch`, async () => {
      const { fetchImpl, calls } = fakeFetch({
        branches: (project) => [
          { id: `${project}-x`, name: "preview/feat/x", [flag]: true },
        ],
      });
      assert.equal(
        await runPreviewTeardown({ env: ENV, fetchImpl, log: quiet }),
        true,
      );
      assert.deepEqual(calls.deleted, []);
    });
  }

  it("treats a missing or already deleted branch as success", async () => {
    const missing = fakeFetch({ branches: () => [] });
    assert.equal(
      await runPreviewTeardown({
        env: ENV,
        fetchImpl: missing.fetchImpl,
        log: quiet,
      }),
      true,
    );
    const gone = fakeFetch({ deleteStatus: 404 });
    assert.equal(
      await runPreviewTeardown({
        env: ENV,
        fetchImpl: gone.fetchImpl,
        log: quiet,
      }),
      true,
    );
  });

  it("retries a delete after a 502, then counts a 404 as done", async () => {
    const { fetchImpl, calls } = fakeFetch({ deleteStatuses: [502, 404] });
    const ok = await runPreviewTeardown({
      env: ENV,
      fetchImpl,
      log: quiet,
      sleep: async () => {},
    });
    assert.equal(ok, true);
    assert.equal(calls.deleted.length, 3);
  });

  it("reports a failed delete but still tries every project", async () => {
    const { fetchImpl, calls } = fakeFetch({ deleteStatus: 400 });
    assert.equal(
      await runPreviewTeardown({ env: ENV, fetchImpl, log: quiet }),
      false,
    );
    assert.equal(calls.deleted.length, 2);
  });

  it("retries a delete while Neon is busy", async () => {
    const waits = [];
    const { fetchImpl, calls } = fakeFetch({ deleteStatuses: [423, 503] });
    const ok = await runPreviewTeardown({
      env: ENV,
      fetchImpl,
      log: quiet,
      sleep: async (ms) => waits.push(ms),
    });
    assert.equal(ok, true);
    assert.deepEqual(calls.deleted, [
      "prj-mainnet-x",
      "prj-mainnet-x",
      "prj-mainnet-x",
      "prj-preprod-x",
    ]);
    assert.deepEqual(waits, [2000, 4000]);
  });

  it("gives up after five busy answers", async () => {
    const { fetchImpl, calls } = fakeFetch({ deleteStatus: 423 });
    const ok = await runPreviewTeardown({
      env: ENV,
      fetchImpl,
      log: quiet,
      sleep: async () => {},
    });
    assert.equal(ok, false);
    assert.equal(calls.deleted.length, 10);
  });

  it("throws when the open PR check fails, before any delete", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push(init.method ?? "GET");
      return json({ message: "boom" }, 502);
    };
    await assert.rejects(
      runPreviewTeardown({ env: ENV, fetchImpl, log: quiet }),
      /GitHub pull request list failed \(502\)/,
    );
    assert.deepEqual(calls, ["GET"]);
  });
});
