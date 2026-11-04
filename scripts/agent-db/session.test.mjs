import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { isAgentRunId } from "./names.mjs";
import {
  addLease,
  agentProcessId,
  defaultSessionId,
  listLeases,
  loadNeonEnv,
  removeLease,
  runIdForRoot,
  withLock,
} from "./session.mjs";

describe("runIdForRoot", () => {
  it("derives a stable bc-<uuid> id from the worktree path", () => {
    // sha256("/home/dev/code/masumi-network/sokosumi") starts 69b1084f2df6…
    const id = runIdForRoot("/home/dev/code/masumi-network/sokosumi");
    assert.match(id, /^bc-69b1084f-2df6-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    assert.equal(isAgentRunId(id), true);
    assert.equal(runIdForRoot("/home/dev/code/masumi-network/sokosumi"), id);
  });

  it("gives each worktree its own id", () => {
    assert.notEqual(runIdForRoot("/a/one"), runIdForRoot("/a/two"));
  });
});

describe("leases", () => {
  async function tmpDir() {
    return mkdtemp(path.join(os.tmpdir(), "agent-db-leases-"));
  }

  it("lists no leases for a missing directory", async () => {
    const dir = path.join(await tmpDir(), "sessions");
    assert.deepEqual(await listLeases(dir), []);
  });

  it("keeps one lease per session and reports who remains", async () => {
    const dir = path.join(await tmpDir(), "sessions");
    await addLease(dir, "claude-1");
    await addLease(dir, "claude-1");
    await addLease(dir, "codex-2");
    assert.deepEqual(await listLeases(dir), ["claude-1", "codex-2"]);

    assert.deepEqual(await removeLease(dir, "claude-1"), ["codex-2"]);
    assert.deepEqual(await removeLease(dir, "claude-1"), ["codex-2"]);
    assert.deepEqual(await removeLease(dir, "codex-2"), []);
  });

  it("keeps session ids inside the lease directory", async () => {
    const root = await tmpDir();
    const dir = path.join(root, "sessions");
    await addLease(dir, "../../etc/passwd");
    assert.deepEqual(await readdir(root), ["sessions"]);
    assert.equal((await listLeases(dir)).length, 1);
    assert.deepEqual(await removeLease(dir, "../../etc/passwd"), []);
  });
});

describe("loadNeonEnv", () => {
  async function keyFile(body) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-db-neon-"));
    const file = path.join(dir, "neon.env");
    await writeFile(file, body, "utf8");
    return file;
  }

  it("fills missing NEON_* values from the key file", async () => {
    const file = await keyFile(
      "# key\nexport NEON_API_KEY='file-key'\nNEON_PROJECT_ID=\"file-proj\"\nOTHER=x\n",
    );
    const env = await loadNeonEnv({ PATH: "/bin" }, file);
    assert.equal(env.NEON_API_KEY, "file-key");
    assert.equal(env.NEON_PROJECT_ID, "file-proj");
    assert.equal(env.OTHER, undefined);
    assert.equal(env.PATH, "/bin");
  });

  it("lets the environment win over the key file", async () => {
    const file = await keyFile("NEON_API_KEY=file-key\nNEON_PROJECT_ID=p\n");
    const env = await loadNeonEnv({ NEON_API_KEY: "env-key" }, file);
    assert.equal(env.NEON_API_KEY, "env-key");
    assert.equal(env.NEON_PROJECT_ID, "p");
  });

  it("returns the environment unchanged without a key file", async () => {
    const env = await loadNeonEnv({ A: "1" }, "/nonexistent/neon.env");
    assert.deepEqual(env, { A: "1" });
  });
});

describe("defaultSessionId", () => {
  const noPid = () => null;

  it("prefers explicit, Claude, hc, then Codex ids", () => {
    const all = {
      AGENT_DB_SESSION_ID: "mine",
      CLAUDE_CODE_SESSION_ID: "claude-uuid",
      HC_SCOPE: "scope",
      HC_TERMINAL_ID: "t3",
      CODEX_THREAD_ID: "thread",
    };
    assert.equal(defaultSessionId(all, noPid), "mine");
    delete all.AGENT_DB_SESSION_ID;
    assert.equal(defaultSessionId(all, noPid), "claude-uuid");
    delete all.CLAUDE_CODE_SESSION_ID;
    assert.equal(defaultSessionId(all, noPid), "hc-scope-t3");
    delete all.HC_TERMINAL_ID;
    assert.equal(defaultSessionId(all, noPid), "codex-thread");
  });

  it("falls back to the agent process, then a fixed name", () => {
    assert.equal(
      defaultSessionId({}, () => 4242),
      "pid-4242",
    );
    assert.equal(defaultSessionId({}, noPid), "shell");
  });
});

describe("agentProcessId", () => {
  it("skips shells and pnpm/node wrappers up to the agent", () => {
    const table = {
      40: { ppid: 30, comm: "node" },
      30: { ppid: 20, comm: "/bin/sh" },
      20: { ppid: 10, comm: "-bash" },
      10: { ppid: 1, comm: "codex" },
    };
    assert.equal(
      agentProcessId(40, (pid) => table[pid] ?? null),
      10,
    );
  });

  it("gives up when the walk reaches init or ps fails", () => {
    assert.equal(
      agentProcessId(5, () => ({ ppid: 1, comm: "bash" })),
      null,
    );
    assert.equal(
      agentProcessId(5, () => null),
      null,
    );
  });
});

describe("withLock", () => {
  it("runs holders one at a time and frees the lock on error", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-db-lock-"));
    const file = path.join(dir, "lock");
    const order = [];
    const slow = withLock(
      file,
      async () => {
        order.push("a:start");
        await new Promise((r) => setTimeout(r, 30));
        order.push("a:end");
      },
      { pollMs: 5 },
    );
    const fast = withLock(file, async () => order.push("b"), { pollMs: 5 });
    await Promise.all([slow, fast]);
    assert.deepEqual(order, ["a:start", "a:end", "b"]);

    await assert.rejects(
      withLock(file, async () => {
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(await withLock(file, async () => "free"), "free");
  });

  it("takes over a lock left by a dead process", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-db-lock-"));
    const file = path.join(dir, "lock");
    // pid_max on Linux is at most 2^22, so this pid cannot be alive.
    await writeFile(file, "99999999\n", "utf8");
    assert.equal(
      await withLock(file, async () => "ok", { timeoutMs: 100 }),
      "ok",
    );
  });
});
