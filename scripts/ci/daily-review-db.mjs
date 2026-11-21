#!/usr/bin/env node
/**
 * Nightly copy of mainnet production for the daily production review, which
 * runs on the CodePat host. Keeps one Neon branch, `review/daily`, in the
 * mainnet project: created once from the protected production branch, then
 * restored to production's current state every night. A restore keeps the
 * branch's id and endpoint, so the reader's host never changes.
 *
 * After each restore it gives the read-only role `daily_review` a new random
 * password and writes the reader's connection URL to `OUT_FILE`, never to the
 * log. The workflow encrypts that file to the review host's age key.
 *
 *   node scripts/ci/daily-review-db.mjs    # daily-review-db.yml
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

import {
  findBranchByName,
  getConnectionUri,
  listBranches,
  neonFetch,
  readNeonConfig,
  retryNeon,
  waitForOperations,
} from "../agent-db/neon-api.mjs";
import { isMainModule } from "./vercel-deploy.mjs";

export const REVIEW_BRANCH = "review/daily";
export const REVIEW_ROLE = "daily_review";
const LOCKED_STATUS = 423;

const ROLE_SQL = `\\set ON_ERROR_STOP on
\\getenv pw REVIEW_PASSWORD
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${REVIEW_ROLE}') THEN
    CREATE ROLE ${REVIEW_ROLE} LOGIN;
  END IF;
END $$;
ALTER ROLE ${REVIEW_ROLE} WITH LOGIN PASSWORD :'pw';
GRANT pg_read_all_data TO ${REVIEW_ROLE};
ALTER ROLE ${REVIEW_ROLE} SET default_transaction_read_only = on;
ALTER ROLE ${REVIEW_ROLE} SET statement_timeout = '120s';
`;

/**
 * The protected default branch, which is production. Throws on anything else,
 * so the copy never comes from a preview or agent branch.
 * @param {{ id: string, name: string, default?: boolean, protected?: boolean }[]} branches
 */
export function productionParent(branches) {
  const parent = branches.find((branch) => branch.default === true);
  if (
    !parent ||
    parent.name.startsWith("preview/") ||
    parent.name.startsWith("cloud-agent-") ||
    parent.name === REVIEW_BRANCH
  ) {
    throw new Error("No production parent in the mainnet Neon project");
  }
  if (parent.protected !== true) {
    throw new Error(
      `The production branch "${parent.name}" must be protected so the review copy gets its own role passwords`,
    );
  }
  return parent;
}

/**
 * Throw unless `branch` is the review copy of `parent`, so a restore never
 * replaces any other branch.
 * @param {{ name: string, parent_id?: string, default?: boolean, protected?: boolean }} branch
 * @param {{ id: string }} parent
 */
export function assertReviewBranch(branch, parent) {
  if (branch.name !== REVIEW_BRANCH) {
    throw new Error(`Refusing to restore "${branch.name}"`);
  }
  if (branch.default === true || branch.protected === true) {
    throw new Error(`Refusing to restore protected branch "${branch.name}"`);
  }
  if (branch.parent_id !== parent.id) {
    throw new Error(`"${branch.name}" has an unexpected parent`);
  }
}

/**
 * The reader's URL on the owner URL's host and database.
 * @param {string} ownerUri
 * @param {string} password
 */
export function readerUri(ownerUri, password) {
  const owner = new URL(ownerUri);
  const reader = new URL(`postgresql://${owner.host}${owner.pathname}`);
  reader.username = REVIEW_ROLE;
  reader.password = password;
  reader.searchParams.set("sslmode", "require");
  return reader.toString();
}

/** Connection settings for psql as environment variables, so no password is on its command line. */
function psqlEnv(uri) {
  const url = new URL(uri);
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1),
    PGSSLMODE: "require",
  };
}

const whileLocked = (request) =>
  retryNeon(request, {
    isRetryable: (error) => error?.status === LOCKED_STATUS,
    attempts: 5,
    firstDelayMs: 1000,
  });

async function main() {
  const config = readNeonConfig();
  const outFile = process.env.OUT_FILE;
  if (!config || !outFile) {
    throw new Error("Set NEON_API_KEY, NEON_PROJECT_ID and OUT_FILE");
  }
  const parent = productionParent(await listBranches(config));

  let branch = await findBranchByName(config, REVIEW_BRANCH);
  if (!branch) {
    const created = await whileLocked(() =>
      neonFetch(config, `/projects/${config.projectId}/branches`, {
        method: "POST",
        body: JSON.stringify({
          branch: { name: REVIEW_BRANCH, parent_id: parent.id },
          endpoints: [{ type: "read_write" }],
        }),
      }),
    );
    branch = created?.branch;
    await waitForOperations(config, created?.operations ?? []);
    console.log(`Created ${REVIEW_BRANCH} from ${parent.name}.`);
  } else {
    assertReviewBranch(branch, parent);
    const restored = await whileLocked(() =>
      neonFetch(
        config,
        `/projects/${config.projectId}/branches/${branch.id}/restore`,
        {
          method: "POST",
          body: JSON.stringify({ source_branch_id: parent.id }),
        },
      ),
    );
    await waitForOperations(config, restored?.operations ?? []);
    console.log(`Restored ${REVIEW_BRANCH} to ${parent.name}.`);
  }
  if (!branch?.id) throw new Error(`${REVIEW_BRANCH} is missing`);

  const ownerUri = await getConnectionUri(config, {
    branchId: branch.id,
    pooled: false,
  });
  const password = randomBytes(24).toString("base64url");
  execFileSync("psql", ["-q", "-X"], {
    input: ROLE_SQL,
    env: { ...psqlEnv(ownerUri), REVIEW_PASSWORD: password },
    stdio: ["pipe", "ignore", "inherit"],
  });
  writeFileSync(outFile, readerUri(ownerUri, password), { mode: 0o600 });
  console.log(`Rotated the ${REVIEW_ROLE} password.`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
