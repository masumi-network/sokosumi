import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { down, up } from "./db.mjs";
import { addLease, listLeases } from "./session.mjs";

const RUN_ID = "bc-11111111-2222-3333-4444-555555555555";

/** A checkout with a provisioned branch and the given leases; no Neon. */
async function checkout({ leases = [], branch = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-db-cli-"));
  await mkdir(path.join(root, "apps", "core"), { recursive: true });
  await writeFile(path.join(root, "apps", "core", ".env"), "", "utf8");
  if (branch) {
    await mkdir(path.join(root, ".agent-db"), { recursive: true });
    await writeFile(
      path.join(root, ".agent-db", "state.json"),
      JSON.stringify({ agentId: RUN_ID, branchName: `cloud-agent-${RUN_ID}` }),
      "utf8",
    );
  }
  const sessions = path.join(root, ".agent-db", "sessions");
  for (const id of leases) await addLease(sessions, id);
  return { root, sessions };
}

function deferred() {
  /** @type {(value: number) => void} */
  let resolve = () => {};
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Context whose subprocesses are stubbed: `script` maps provision/teardown to
 * an exit status, or a promise of one.
 * @param {string} root
 * @param {{ provision?: number | Promise<number>, teardown?: number | Promise<number> }} [script]
 */
function context(root, script = {}) {
  /** @type {string[]} */
  const calls = [];
  return {
    calls,
    ctx: {
      root,
      env: { NEON_API_KEY: "k", NEON_PROJECT_ID: "p" },
      keyFile: path.join(root, "no-key-file"),
      lock: { pollMs: 5 },
      log: () => {},
      run: async (/** @type {string[]} */ args) => {
        const name = path.basename(args[1] ?? args[0], ".mjs");
        calls.push(`${name}:start`);
        const status = await (name === "provision"
          ? (script.provision ?? 0)
          : (script.teardown ?? 0));
        calls.push(`${name}:end`);
        return status;
      },
    },
  };
}

describe("db down", () => {
  it("keeps the branch while another session holds it", async () => {
    const { root, sessions } = await checkout({ leases: ["a", "b"] });
    const { ctx, calls } = context(root);
    assert.equal(await down(ctx, "a", {}), 0);
    assert.deepEqual(calls, []);
    assert.deepEqual(await listLeases(sessions), ["b"]);
  });

  it("deletes the branch when the last lease goes", async () => {
    const { root, sessions } = await checkout({ leases: ["a"] });
    const { ctx, calls } = context(root);
    assert.equal(await down(ctx, "a", {}), 0);
    assert.deepEqual(calls, ["teardown:start", "teardown:end"]);
    assert.deepEqual(await listLeases(sessions), []);
  });

  it("does nothing for a hook whose session holds no lease", async () => {
    const { root, sessions } = await checkout({ leases: [] });
    const { ctx, calls } = context(root);
    assert.equal(await down(ctx, "never-ran-up", { hook: true }), 0);
    assert.deepEqual(calls, []);
    assert.deepEqual(await listLeases(sessions), []);
  });

  it("restores the released lease when teardown fails", async () => {
    const { root, sessions } = await checkout({ leases: ["a"] });
    const { ctx } = context(root, { teardown: 1 });
    assert.equal(await down(ctx, "a", {}), 1);
    assert.deepEqual(await listLeases(sessions), ["a"]);
  });

  it("--force deletes the branch but leaves other sessions' leases", async () => {
    const { root, sessions } = await checkout({ leases: ["a", "b"] });
    const { ctx, calls } = context(root);
    assert.equal(await down(ctx, "a", { force: true }), 0);
    assert.deepEqual(calls, ["teardown:start", "teardown:end"]);
    assert.deepEqual(await listLeases(sessions), ["b"]);
  });
});

describe("db up", () => {
  it("holds its lease while provisioning", async () => {
    const { root, sessions } = await checkout({ branch: false });
    const { ctx } = context(root);
    /** @type {string[]} */
    let seen = [];
    ctx.run = async () => {
      seen = await listLeases(sessions);
      return 0;
    };
    assert.equal(await up(ctx, "a"), 0);
    assert.deepEqual(seen, ["a"]);
    assert.deepEqual(await listLeases(sessions), ["a"]);
  });

  it("drops a new lease when provisioning fails, keeps an existing one", async () => {
    const { root, sessions } = await checkout({ leases: ["old"] });
    const { ctx } = context(root, { provision: 1 });
    assert.equal(await up(ctx, "new"), 1);
    assert.equal(await up(ctx, "old"), 1);
    assert.deepEqual(await listLeases(sessions), ["old"]);
  });
});

describe("db up and down racing", () => {
  it("an up during the last down waits, then provisions again", async () => {
    const { root, sessions } = await checkout({ leases: ["a"] });
    const teardown = deferred();
    const { ctx, calls } = context(root, { teardown: teardown.promise });

    const leaving = down(ctx, "a", {});
    await new Promise((r) => setTimeout(r, 20));
    const joining = up(ctx, "b");
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(calls, ["teardown:start"]);

    teardown.resolve(0);
    assert.equal(await leaving, 0);
    assert.equal(await joining, 0);
    assert.deepEqual(calls, [
      "teardown:start",
      "teardown:end",
      "provision:start",
      "provision:end",
    ]);
    assert.deepEqual(await listLeases(sessions), ["b"]);
  });

  it("a down during an up keeps the branch the up is provisioning", async () => {
    const { root, sessions } = await checkout({ leases: ["a"] });
    const provision = deferred();
    const { ctx, calls } = context(root, { provision: provision.promise });

    const joining = up(ctx, "b");
    await new Promise((r) => setTimeout(r, 20));
    const leaving = down(ctx, "a", {});
    await new Promise((r) => setTimeout(r, 50));

    provision.resolve(0);
    assert.equal(await joining, 0);
    assert.equal(await leaving, 0);
    assert.deepEqual(calls, ["provision:start", "provision:end"]);
    assert.deepEqual(await listLeases(sessions), ["b"]);
  });
});
