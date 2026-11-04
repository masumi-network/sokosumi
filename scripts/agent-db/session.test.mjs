import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { isAgentRunId } from "./names.mjs";
import {
  addLease,
  listLeases,
  loadNeonEnv,
  removeLease,
  runIdForRoot,
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
