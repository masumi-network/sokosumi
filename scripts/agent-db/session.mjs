/** Per-worktree agent DB sessions: run id, session id, leases, lock, Neon key lookup. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Stable run id for a checkout, so a resumed session finds its branch again.
 * @param {string} root real path of the checkout root (what `git rev-parse --show-toplevel` prints)
 * @returns {string} `bc-<uuid-shaped sha256>`
 */
export function runIdForRoot(root) {
  const h = createHash("sha256").update(root).digest("hex");
  return `bc-${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Lease file name for a session id; anything outside [A-Za-z0-9._-] becomes "_".
 * @param {string} sessionId
 */
function leaseName(sessionId) {
  const name = sessionId.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  if (!name || /^\.+$/.test(name)) throw new Error("session id is required");
  return name;
}

/**
 * Sessions currently holding the branch, sorted.
 * @param {string} dir lease directory (`.agent-db/sessions`)
 * @returns {Promise<string[]>}
 */
export async function listLeases(dir) {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

/**
 * @param {string} dir
 * @param {string} sessionId
 */
export async function hasLease(dir, sessionId) {
  return (await listLeases(dir)).includes(leaseName(sessionId));
}

/**
 * @param {string} dir
 * @param {string} sessionId
 */
export async function addLease(dir, sessionId) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, leaseName(sessionId)),
    `${JSON.stringify({ sessionId, since: new Date().toISOString() })}\n`,
    "utf8",
  );
}

/**
 * Drop this session's lease (if any) and return the sessions still holding it.
 * @param {string} dir
 * @param {string} sessionId
 * @returns {Promise<string[]>}
 */
export async function removeLease(dir, sessionId) {
  await rm(path.join(dir, leaseName(sessionId)), { force: true });
  return listLeases(dir);
}

/** Default Neon key file for machines outside Cursor. */
export const NEON_KEY_FILE = path.join(
  os.homedir(),
  ".config",
  "sokosumi",
  "neon.env",
);

/**
 * Environment with NEON_* values filled from a `KEY=value` file; the
 * environment wins. Returns a copy; never logs values.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} [file]
 * @returns {Promise<NodeJS.ProcessEnv>}
 */
export async function loadNeonEnv(env, file = NEON_KEY_FILE) {
  const out = { ...env };
  let body;
  try {
    body = await readFile(file, "utf8");
  } catch {
    return out;
  }
  for (const line of body.split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?(NEON_[A-Z0-9_]+)=(.*)$/);
    if (!match || out[match[1]]) continue;
    out[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/** Processes between an agent and db.mjs: pnpm, node and the shells they spawn. */
const WRAPPER_COMMANDS = new Set([
  "bash",
  "corepack",
  "dash",
  "env",
  "fish",
  "node",
  "npm",
  "npx",
  "pnpm",
  "sh",
  "zsh",
]);

/**
 * @param {number} pid
 * @returns {{ ppid: number, comm: string } | null}
 */
function psLookup(pid) {
  try {
    const out = execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim();
    const match = out.match(/^(\d+)\s+(.+)$/);
    return match ? { ppid: Number(match[1]), comm: match[2] } : null;
  } catch {
    return null;
  }
}

/**
 * The nearest ancestor that is not a shell or package-manager wrapper: the
 * agent (or terminal) that ran `pnpm db:up`, stable for the whole session,
 * where each tool call gets a fresh shell.
 * @param {number} startPid usually `process.ppid`
 * @param {(pid: number) => { ppid: number, comm: string } | null} [lookup]
 * @returns {number | null}
 */
export function agentProcessId(startPid, lookup = psLookup) {
  let pid = startPid;
  for (let depth = 0; pid > 1 && depth < 32; depth += 1) {
    const entry = lookup(pid);
    if (!entry) return null;
    const name = path.basename(entry.comm).replace(/^-/, "");
    if (!WRAPPER_COMMANDS.has(name)) return pid;
    pid = entry.ppid;
  }
  return null;
}

/**
 * Lease id for a session that passed no `--session` and no hook JSON, most
 * specific first:
 *   AGENT_DB_SESSION_ID → CLAUDE_CODE_SESSION_ID (matches hook `session_id`)
 *   → hc terminal (HC_SCOPE + HC_TERMINAL_ID) → CODEX_THREAD_ID
 *   → agent process id → "shell".
 * Grok exposes no session id to tool shells (GROK_SESSION_ID is hook-only),
 * so it lands on the hc terminal or its process id.
 * @param {NodeJS.ProcessEnv} env
 * @param {() => number | null} [processId]
 */
export function defaultSessionId(
  env,
  processId = () => agentProcessId(process.ppid),
) {
  if (env.AGENT_DB_SESSION_ID) return env.AGENT_DB_SESSION_ID;
  if (env.CLAUDE_CODE_SESSION_ID) return env.CLAUDE_CODE_SESSION_ID;
  if (env.HC_TERMINAL_ID) {
    return ["hc", env.HC_SCOPE, env.HC_TERMINAL_ID].filter(Boolean).join("-");
  }
  if (env.CODEX_THREAD_ID) return `codex-${env.CODEX_THREAD_ID}`;
  const pid = processId();
  return pid ? `pid-${pid}` : "shell";
}

/**
 * @param {string} file
 */
async function lockIsStale(file) {
  const pid = Number((await readFile(file, "utf8").catch(() => "")).trim());
  // Empty: the holder is between create and write.
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // EPERM: alive but not ours to signal.
    return /** @type {NodeJS.ErrnoException} */ (error).code === "ESRCH";
  }
}

/**
 * Run `fn` holding an exclusive lock file (created with O_EXCL, holding the
 * pid). A lock left by a dead process is taken over.
 * @template T
 * @param {string} file
 * @param {() => Promise<T>} fn
 * @param {{ pollMs?: number, timeoutMs?: number }} [options]
 * @returns {Promise<T>}
 */
export async function withLock(
  file,
  fn,
  { pollMs = 250, timeoutMs = 15 * 60 * 1000 } = {},
) {
  await mkdir(path.dirname(file), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await writeFile(file, `${process.pid}\n`, { flag: "wx" });
      break;
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") {
        throw error;
      }
      if (await lockIsStale(file)) {
        await rm(file, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${file}`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(file, { force: true });
  }
}
