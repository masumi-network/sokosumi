#!/usr/bin/env node
/**
 * One Neon branch of production per checkout, shared by the agent sessions
 * working in it.
 *
 * Usage (from the repo root):
 *   pnpm db:up       provision or reuse this checkout's branch, add a lease
 *   pnpm db:down     drop this session's lease; delete the branch when none remain
 *   pnpm db:down --force   delete the branch whoever holds it
 *   pnpm db:status   branch, expiry and leases
 *
 * Options: --session <id> (lease id; default order in `defaultSessionId`,
 * session.mjs), --hook (read Claude Code hook JSON on stdin: `status --hook`
 * prints a SessionStart hint, `down --hook` releases the hook's `session_id`
 * and does nothing when that session holds no lease).
 *
 * `up` and `down` hold `.agent-db/lock`: `up` takes its lease before
 * provisioning, and `down` decides on teardown under the same lock, so a
 * session joining mid-teardown waits and then gets a fresh branch.
 *
 * Neon key: NEON_API_KEY / NEON_PROJECT_ID from the environment, else
 * ~/.config/sokosumi/neon.env. Without one, `up` skips and the checkout keeps
 * its local Postgres.
 */

import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { lockFilePath, readState, sessionsDirPath } from "./apply-env.mjs";
import { isAgentRunId } from "./names.mjs";
import { readNeonConfig } from "./neon-api.mjs";
import {
  addLease,
  defaultSessionId,
  hasLease,
  listLeases,
  loadNeonEnv,
  NEON_KEY_FILE,
  removeLease,
  runIdForRoot,
  withLock,
} from "./session.mjs";
import { isMainModule } from "./teardown.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {object} Context
 * @property {string} root checkout root (real path)
 * @property {NodeJS.ProcessEnv} env
 * @property {string} [keyFile] Neon key file (default ~/.config/sokosumi/neon.env)
 * @property {(args: string[], env: NodeJS.ProcessEnv) => Promise<number>} run
 * @property {(message: string) => void} log
 * @property {{ pollMs?: number }} [lock]
 */

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const opts = { command: argv[0] ?? "status", force: false, hook: false };
  /** @type {string | undefined} */
  let session;
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--force") opts.force = true;
    else if (arg === "--hook") opts.hook = true;
    else if (arg === "--session") session = argv[++i];
    else if (arg.startsWith("--session=")) session = arg.slice(10);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return { ...opts, session };
}

async function readHookSessionId() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try {
    const id = JSON.parse(raw)?.session_id;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Cursor keeps its conversation id so PR-body teardown still finds the branch;
 * a checkout that already has a branch keeps that branch's id.
 * @param {Context} ctx
 * @param {{ agentId?: string } | null} state
 */
function resolveRunId(ctx, state) {
  for (const id of [
    ctx.env.CLOUD_AGENT_RUN_ID,
    ctx.env.CURSOR_CONVERSATION_ID,
    state?.agentId,
  ]) {
    if (isAgentRunId(id)) return id.trim().toLowerCase();
  }
  return runIdForRoot(ctx.root);
}

/**
 * @param {string} root
 * @returns {(args: string[], env: NodeJS.ProcessEnv) => Promise<number>}
 */
function spawnRunner(root) {
  return (args, env) =>
    new Promise((resolve) => {
      const child = spawn(args[0], args.slice(1), {
        cwd: root,
        env,
        stdio: "inherit",
      });
      child.on("error", () => resolve(1));
      child.on("exit", (code) => resolve(code ?? 1));
    });
}

/**
 * @param {Context} ctx
 * @param {() => Promise<number>} fn
 */
function locked(ctx, fn) {
  return withLock(lockFilePath(ctx.root), fn, ctx.lock);
}

/**
 * @param {Context} ctx
 * @param {string} sessionId
 * @returns {Promise<number>}
 */
export async function up(ctx, sessionId) {
  const env = await loadNeonEnv(ctx.env, ctx.keyFile);
  if (!readNeonConfig(env)) {
    ctx.log(
      `No Neon key (NEON_API_KEY / NEON_PROJECT_ID or ${ctx.keyFile ?? NEON_KEY_FILE}); ` +
        "keeping the local Postgres in apps/core/.env.",
    );
    return 0;
  }

  const sessionsDir = sessionsDirPath(ctx.root);
  return locked(ctx, async () => {
    const held = (await listLeases(sessionsDir)).length;
    // Lease first, so a concurrent `down` never deletes the branch we provision.
    await addLease(sessionsDir, sessionId);
    const isNew = (await listLeases(sessionsDir)).length > held;

    let status = 0;
    if (!existsSync(path.join(ctx.root, "apps", "core", ".env"))) {
      status = await ctx.run(["pnpm", "env:bootstrap"], env);
    }
    if (status === 0) {
      status = await ctx.run(
        [process.execPath, path.join(__dirname, "provision.mjs")],
        {
          ...env,
          CLOUD_AGENT_DB_FORCE: "1",
          CLOUD_AGENT_RUN_ID: resolveRunId(ctx, await readState(ctx.root)),
        },
      );
    }
    if (status !== 0) {
      if (isNew) await removeLease(sessionsDir, sessionId);
      return status;
    }

    const leases = await listLeases(sessionsDir);
    ctx.log(
      `Lease ${sessionId} added (${leases.length} session(s) on this branch)`,
    );
    return 0;
  });
}

/**
 * @param {Context} ctx
 * @param {string} sessionId
 * @param {{ force?: boolean, hook?: boolean }} opts
 * @returns {Promise<number>}
 */
export async function down(ctx, sessionId, opts) {
  const sessionsDir = sessionsDirPath(ctx.root);
  // A hook for a session that never ran `up` must not wait on the lock.
  if (opts.hook && !(await hasLease(sessionsDir, sessionId))) return 0;
  return locked(ctx, async () => {
    const before = await listLeases(sessionsDir);
    const remaining = await removeLease(sessionsDir, sessionId);
    const released = before.length > remaining.length;
    if (opts.hook && !released) return 0;

    if (!opts.force && remaining.length > 0) {
      ctx.log(`Branch kept; still used by: ${remaining.join(", ")}`);
      return 0;
    }

    const state = await readState(ctx.root);
    if (!state && !opts.force) {
      ctx.log(`No branch for ${ctx.root}`);
      return 0;
    }

    const status = await ctx.run(
      [
        process.execPath,
        path.join(__dirname, "teardown.mjs"),
        "--agent-id",
        resolveRunId(ctx, state),
      ],
      await loadNeonEnv(ctx.env, ctx.keyFile),
    );
    // Keep holding a branch that is still there.
    if (status !== 0 && released) await addLease(sessionsDir, sessionId);
    return status;
  });
}

/**
 * @param {Context} ctx
 * @param {{ hook: boolean }} opts
 */
async function status(ctx, opts) {
  const state = await readState(ctx.root);
  const leases = await listLeases(sessionsDirPath(ctx.root));
  if (opts.hook) {
    console.log(
      state
        ? `This checkout has a Neon branch of production (${state.branchName}); its URLs are in apps/core/.env, apps/web/.env and packages/database/.env. Run \`pnpm db:down\` when you are done with it.`
        : "Postgres: this checkout has no Neon branch yet. When you need a database, run `pnpm db:up` (a Neon branch of production with test logins from docs/agents/agent-database.md, about a minute), and `pnpm db:down` when done.",
    );
    return 0;
  }
  if (!state) {
    ctx.log(`No branch for ${ctx.root}; run \`pnpm db:up\``);
    return 0;
  }
  ctx.log(
    `${state.branchName} on ${state.databaseUrlHost}, expires ${state.expiresAt}`,
  );
  ctx.log(`Sessions: ${leases.length > 0 ? leases.join(", ") : "none"}`);
  return 0;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = realpathSync(path.resolve(__dirname, "../.."));
  /** @type {Context} */
  const ctx = {
    root,
    env: process.env,
    run: spawnRunner(root),
    log: (message) => console.log(`[agent-db] ${message}`),
  };
  const sessionId =
    opts.session ??
    (opts.hook ? await readHookSessionId() : undefined) ??
    defaultSessionId(process.env);

  if (opts.command === "up") return up(ctx, sessionId);
  if (opts.command === "down") return down(ctx, sessionId, opts);
  if (opts.command === "status") return status(ctx, opts);
  console.error("usage: node scripts/agent-db/db.mjs up|down|status");
  return 2;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main();
}
