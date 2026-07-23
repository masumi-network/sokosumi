import { isAgentBranchName } from "./names.mjs";

/**
 * Hard guards before writing auth fixtures.
 * Never run against production/main parent or non-agent branches.
 *
 * @param {{
 *   branchName?: string | null,
 *   databaseUrl?: string | null,
 *   force?: boolean,
 * }} input
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkAgentFixtureSafety(input) {
  const branchName = input.branchName?.trim() ?? "";
  const databaseUrl = input.databaseUrl?.trim() ?? "";
  const force = input.force === true;

  if (!branchName && !force) {
    return {
      ok: false,
      reason: "missing cloud-agent branch name in provision state",
    };
  }

  if (branchName && !isAgentBranchName(branchName)) {
    return {
      ok: false,
      reason: `refusing fixtures on non-agent branch "${branchName}"`,
    };
  }

  if (!databaseUrl) {
    return { ok: false, reason: "DATABASE_URL unset" };
  }

  let host = "";
  try {
    host = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    return { ok: false, reason: "DATABASE_URL is not a valid URL" };
  }

  // Local Postgres is fine for forced dry-runs, but never treat bare
  // production-looking hosts without an agent branch marker as safe.
  if (!branchName && force) {
    if (host === "localhost" || host === "127.0.0.1") {
      return { ok: true };
    }
    return {
      ok: false,
      reason:
        "CLOUD_AGENT_DB_FORCE fixtures require cloud-agent-* branch state (or localhost)",
    };
  }

  return { ok: true };
}

/**
 * @param {{ ok: true } | { ok: false, reason: string }} result
 */
export function assertAgentFixtureSafety(result) {
  if (!result.ok) {
    throw new Error(`Auth fixtures blocked: ${result.reason}`);
  }
}
