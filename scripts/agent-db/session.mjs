/** Per-worktree agent DB sessions: run id, leases, Neon key lookup. */

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
