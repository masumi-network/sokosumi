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
 * Same, but rejects anything that is not a well-formed `bc-<uuid>` run id.
 *
 * Use at UNTRUSTED entry points (the teardown CLI's `--agent-id`, reachable via
 * workflow_dispatch) so a caller cannot steer deletion at an arbitrary branch
 * that merely carries the prefix — `isAgentBranchName` checks the prefix alone
 * and cannot catch that. Provisioning deliberately keeps using the lenient
 * `agentBranchName`: it warns and proceeds on a non-standard conversation id
 * rather than failing the environment setup.
 *
 * @param {string} agentId
 * @returns {string}
 */
export function requireAgentBranchName(agentId) {
  const id = agentId.trim();
  if (!isAgentRunId(id)) {
    throw new Error(`Invalid agent run id "${agentId}" (expected bc-<uuid>)`);
  }
  return agentBranchName(id);
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
