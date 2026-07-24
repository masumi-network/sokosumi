/** Branch naming and TTL helpers for Cloud agent Neon DBs. */

export const BRANCH_PREFIX = "cloud-agent-";

/** Idle TTL for agent DB branches (72 hours). */
export const IDLE_TTL_MS = 72 * 60 * 60 * 1000;

/** Neon branch names: alphanumeric, underscores, hyphens. */
const AGENT_ID_PATTERN = /^bc-[a-f0-9-]+$/i;

/**
 * @param {string} agentId
 * @returns {string}
 */
export function agentBranchName(agentId) {
  const id = agentId.trim();
  if (!id) throw new Error("agent id is required");
  return `${BRANCH_PREFIX}${id}`;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isAgentBranchName(name) {
  return typeof name === "string" && name.startsWith(BRANCH_PREFIX);
}

/**
 * @param {string | undefined | null} agentId
 * @returns {boolean}
 */
export function isAgentRunId(agentId) {
  return typeof agentId === "string" && AGENT_ID_PATTERN.test(agentId.trim());
}

/**
 * Extract Cloud agent run ids (`bc-…`) from PR bodies, comments, or links.
 * @param {string} text
 * @returns {string[]}
 */
export function extractAgentIdsFromText(text) {
  if (!text) return [];
  const matches = text.matchAll(
    /\bbc-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\b/gi,
  );
  const ids = new Set();
  for (const match of matches) {
    ids.add(match[0].toLowerCase());
  }
  return [...ids];
}

/**
 * @param {number} [nowMs]
 * @returns {string} RFC 3339 timestamp
 */
export function expiresAtIso(nowMs = Date.now()) {
  return new Date(nowMs + IDLE_TTL_MS).toISOString();
}

/**
 * Whether an agent branch is past its idle TTL and safe for `--idle-gc`.
 *
 * Prefer Neon `expires_at` (refreshed on provision resume). Falling back to
 * `created_at + 72h` would delete long-lived resumed branches early and defeat
 * the TTL refresh — only use created_at when expires_at is missing.
 *
 * @param {{ expiresAt?: string | null, createdAt?: string | null }} input
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function isIdlePastTtl(input, nowMs = Date.now()) {
  const expiresAt = input?.expiresAt ?? null;
  const createdAt = input?.createdAt ?? null;

  if (expiresAt) {
    const expires = Date.parse(expiresAt);
    if (Number.isNaN(expires)) return false;
    return nowMs >= expires;
  }

  if (createdAt) {
    const created = Date.parse(createdAt);
    if (Number.isNaN(created)) return false;
    return nowMs - created >= IDLE_TTL_MS;
  }

  return false;
}
