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
 */
export function assertAgentFixtureSafety(input) {
  const branchName = input.branchName?.trim() ?? "";
  const databaseUrl = input.databaseUrl?.trim() ?? "";
  const force = input.force === true;

  function block(reason) {
    throw new Error(`Auth fixtures blocked: ${reason}`);
  }

  if (!branchName && !force) {
    block("missing cloud-agent branch name in provision state");
  }

  if (branchName && !isAgentBranchName(branchName)) {
    block(`refusing fixtures on non-agent branch "${branchName}"`);
  }

  if (!databaseUrl) {
    block("DATABASE_URL unset");
  }

  let host = "";
  try {
    host = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    block("DATABASE_URL is not a valid URL");
  }

  // Local Postgres is fine for forced dry-runs, but never treat bare
  // production-looking hosts without an agent branch marker as safe.
  if (!branchName && force) {
    if (host === "localhost" || host === "127.0.0.1") {
      return;
    }
    block(
      "CLOUD_AGENT_DB_FORCE fixtures require cloud-agent-* branch state (or localhost)",
    );
  }
}
