import { parseNeonDatabaseUrl } from "../../packages/database/src/helpers/migrate-deploy-preflight.ts";
import { isAgentBranchName } from "./names.mjs";

/**
 * @param {{ name: string, parent_id?: string, default?: boolean, protected?: boolean }} branch
 * @param {string} expectedName
 * @param {string} expectedParentId
 */
export function assertAgentBranchSafety(
  branch,
  expectedName,
  expectedParentId,
) {
  if (branch.name !== expectedName || !isAgentBranchName(branch.name)) {
    throw new Error(
      `Neon branch "${branch.name}" is not the expected cloud-agent branch "${expectedName}". Check the branch name in Neon and retry provisioning.`,
    );
  }
  if (branch.default || branch.protected) {
    throw new Error(
      `Neon agent branch "${expectedName}" is default or protected. Use a disposable agent branch and retry provisioning.`,
    );
  }
  if (branch.parent_id !== expectedParentId) {
    throw new Error(
      `Neon agent branch "${expectedName}" has an unexpected parent (expected ${expectedParentId}). Check NEON_PARENT_BRANCH, then run pnpm db:down followed by pnpm db:up.`,
    );
  }
}

/**
 * Hard guards before writing auth fixtures.
 * Never run against production/main parent or non-agent branches.
 *
 * @param {{
 *   branchName?: string | null,
 *   databaseUrl?: string | null,
 *   databaseUrlUnpooledHost?: string | null,
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
    block(
      "missing cloud-agent branch name in provision state. Provision the agent database before seeding.",
    );
  }

  if (branchName && !isAgentBranchName(branchName)) {
    block(
      `refusing fixtures on non-agent branch "${branchName}". Provision the agent database before seeding.`,
    );
  }

  if (!databaseUrl) {
    block(
      "DATABASE_URL unset. Run the seed with scripts/agent-db/with-db.mjs.",
    );
  }

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    block(
      "DATABASE_URL is not a valid URL. Run the seed with scripts/agent-db/with-db.mjs.",
    );
  }

  // Local Postgres is fine for forced dry-runs, but never treat bare
  // production-looking hosts without an agent branch marker as safe.
  if (!branchName && force) {
    if (
      ["localhost", "127.0.0.1"].includes(url.hostname.toLowerCase()) &&
      !url.searchParams.has("host")
    ) {
      return;
    }
    block(
      "CLOUD_AGENT_DB_FORCE fixtures require cloud-agent-* branch state (or localhost)",
    );
  }

  if (!input.databaseUrlUnpooledHost) {
    block(
      "provision state has no verified endpoint. Run pnpm db:up or rerun agent DB provisioning before seeding.",
    );
  }
  const parsed = parseNeonDatabaseUrl(databaseUrl);
  if (parsed?.error) {
    block(
      `the selected database URL ${parsed.error}. Run node scripts/agent-db/with-db.mjs -- pnpm agent-db:seed-auth.`,
    );
  }
  if (parsed?.endpointHost !== input.databaseUrlUnpooledHost) {
    block(
      "the selected database URL does not match the verified agent branch endpoint. Run node scripts/agent-db/with-db.mjs -- pnpm agent-db:seed-auth.",
    );
  }
}
