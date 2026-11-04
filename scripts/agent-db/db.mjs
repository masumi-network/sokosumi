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
 * Options: --session <id> (lease id; default AGENT_DB_SESSION_ID,
 * CLAUDE_CODE_SESSION_ID, else "shell"), --hook (read Claude Code hook JSON on
 * stdin: `status --hook` prints a SessionStart hint, `down --hook` releases the
 * hook's session and does nothing when that session holds no lease).
 *
 * Neon key: NEON_API_KEY / NEON_PROJECT_ID from the environment, else
 * ~/.config/sokosumi/neon.env. Without one, `up` skips and the checkout keeps
 * its local Postgres.
 */

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readState, sessionsDirPath } from "./apply-env.mjs";
import { isAgentRunId } from "./names.mjs";
import { readNeonConfig } from "./neon-api.mjs";
import {
  addLease,
  listLeases,
  loadNeonEnv,
  NEON_KEY_FILE,
  removeLease,
  runIdForRoot,
} from "./session.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = realpathSync(path.resolve(__dirname, "../.."));
const SESSIONS_DIR = sessionsDirPath(REPO_ROOT);

function log(message) {
  console.log(`[agent-db] ${message}`);
}

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
 * @param {{ agentId?: string } | null} state
 */
function resolveRunId(state) {
  const env = process.env;
  for (const id of [
    env.CLOUD_AGENT_RUN_ID,
    env.CURSOR_CONVERSATION_ID,
    state?.agentId,
  ]) {
    if (isAgentRunId(id)) return id.trim().toLowerCase();
  }
  return runIdForRoot(REPO_ROOT);
}

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 */
function run(args, env) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: REPO_ROOT,
    env,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

/**
 * @param {string} sessionId
 */
async function up(sessionId) {
  const env = await loadNeonEnv(process.env);
  if (!readNeonConfig(env)) {
    log(
      `No Neon key (NEON_API_KEY / NEON_PROJECT_ID or ${NEON_KEY_FILE}); ` +
        "keeping the local Postgres in apps/core/.env.",
    );
    return 0;
  }

  if (!existsSync(path.join(REPO_ROOT, "apps", "core", ".env"))) {
    const status = run(["pnpm", "env:bootstrap"], env);
    if (status !== 0) return status;
  }

  const status = run(
    [process.execPath, path.join(__dirname, "provision.mjs")],
    {
      ...env,
      CLOUD_AGENT_DB_FORCE: "1",
      CLOUD_AGENT_RUN_ID: resolveRunId(await readState(REPO_ROOT)),
    },
  );
  if (status !== 0) return status;

  await addLease(SESSIONS_DIR, sessionId);
  const leases = await listLeases(SESSIONS_DIR);
  log(`Lease ${sessionId} added (${leases.length} session(s) on this branch)`);
  return 0;
}

/**
 * @param {string} sessionId
 * @param {{ force: boolean, hook: boolean }} opts
 */
async function down(sessionId, opts) {
  const before = await listLeases(SESSIONS_DIR);
  const remaining = await removeLease(SESSIONS_DIR, sessionId);
  if (opts.hook && before.length === remaining.length) return 0;

  if (!opts.force && remaining.length > 0) {
    log(`Branch kept; still used by: ${remaining.join(", ")}`);
    return 0;
  }

  const state = await readState(REPO_ROOT);
  if (!state && !opts.force) {
    log(`No branch for ${REPO_ROOT}`);
    return 0;
  }

  const status = run(
    [
      process.execPath,
      path.join(__dirname, "teardown.mjs"),
      "--agent-id",
      resolveRunId(state),
    ],
    await loadNeonEnv(process.env),
  );
  // Keep holding a branch that is still there.
  if (status !== 0 && before.length > remaining.length) {
    await addLease(SESSIONS_DIR, sessionId);
  }
  return status;
}

/**
 * @param {{ hook: boolean }} opts
 */
async function status(opts) {
  const state = await readState(REPO_ROOT);
  const leases = await listLeases(SESSIONS_DIR);
  if (opts.hook) {
    console.log(
      state
        ? `This checkout has a Neon branch of production (${state.branchName}); its URLs are in apps/core/.env, apps/web/.env and packages/database/.env. Run \`pnpm db:down\` when you are done with it.`
        : "Postgres: this checkout has no Neon branch yet. When you need a database, run `pnpm db:up` (a Neon branch of production with test logins from docs/agents/agent-database.md, about a minute), and `pnpm db:down` when done.",
    );
    return 0;
  }
  if (!state) {
    log(`No branch for ${REPO_ROOT}; run \`pnpm db:up\``);
    return 0;
  }
  log(
    `${state.branchName} on ${state.databaseUrlHost}, expires ${state.expiresAt}`,
  );
  log(`Sessions: ${leases.length > 0 ? leases.join(", ") : "none"}`);
  return 0;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sessionId =
    opts.session ??
    (opts.hook ? await readHookSessionId() : undefined) ??
    process.env.AGENT_DB_SESSION_ID ??
    process.env.CLAUDE_CODE_SESSION_ID ??
    "shell";

  if (opts.command === "up") return up(sessionId);
  if (opts.command === "down") return down(sessionId, opts);
  if (opts.command === "status") return status(opts);
  console.error("usage: node scripts/agent-db/db.mjs up|down|status");
  return 2;
}

process.exitCode = await main();
