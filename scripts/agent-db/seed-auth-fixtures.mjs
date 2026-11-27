#!/usr/bin/env node

/**
 * Upsert known Better Auth credential users on an agent Neon branch only.
 *
 * Safety: requires cloud-agent-* branch in provision state (or localhost + FORCE).
 * Never targets production/main parent.
 */

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readState, readUrlsFile } from "./apply-env.mjs";
import { assertAgentFixtureSafety } from "./assert-agent-database.mjs";
import {
  AUTH_FIXTURES,
  FIXTURE_PASSWORD,
  fixtureWantsOrganization,
  fixtureWantsPersonalWorkspace,
} from "./fixtures.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

function log(message) {
  console.log(`[agent-db] ${message}`);
}

const ZERO_WORKSPACE_RESET_SAVEPOINT = "zero_workspace_reset";

/**
 * Names the shared tables of one layout with their schema,
 * `"<schema>"."<table>"`, as `sharedTable` of `@sokosumi/database/sql-tables`
 * does (plain Node cannot import that module: it needs the generated client).
 * The layout is read once, before any query, by Core's own parser, so a
 * layout Core refuses stops the seed: a name that is no schema name, a
 * PostgreSQL system schema, or only some of the three names set.
 *
 * @param {Record<string, string | undefined>} env The `DATABASE_SCHEMA_*` variables
 *   and `NETWORK_PREPROD_ENABLED`; blank or missing is `public` and off.
 * @returns {Promise<SharedTable>}
 */
export async function sharedTableFor(env) {
  const { networkLayoutSchema } = await import(
    "../../apps/core/src/config/network-layout.ts"
  );
  const layout = networkLayoutSchema.safeParse(env);
  if (!layout.success) {
    throw new Error(
      `Auth fixtures blocked: ${layout.error.issues
        .map((issue) => [issue.path.join("."), issue.message].join(" "))
        .join("; ")
        .trim()}`,
    );
  }
  return (table) => `"${layout.data.DATABASE_SCHEMA_SHARED}"."${table}"`;
}

/**
 * @typedef {(table: "account" | "member" | "organization" | "session" | "user" | "workspace") => string} SharedTable
 */

/**
 * Best-effort delete of a personal workspace so zero fixtures stay durable.
 * Isolated via SAVEPOINT so Job/Task FK failures do not abort the rest of
 * the fixture transaction (admin/alice/bob password refresh still commits).
 *
 * @param {import("pg").PoolClient | import("pg").Client} client
 * @param {{ userId: string, email: string }} fixtureUser
 * @param {SharedTable} sharedTable
 */
export async function resetUnwantedPersonalWorkspace(
  client,
  fixtureUser,
  sharedTable,
) {
  try {
    await client.query(`SAVEPOINT ${ZERO_WORKSPACE_RESET_SAVEPOINT}`);
    await client.query(
      `DELETE FROM ${sharedTable("workspace")} WHERE "userId" = $1`,
      [fixtureUser.userId],
    );
    await client.query(`RELEASE SAVEPOINT ${ZERO_WORKSPACE_RESET_SAVEPOINT}`);
    return { reset: true };
  } catch (error) {
    try {
      await client.query(
        `ROLLBACK TO SAVEPOINT ${ZERO_WORKSPACE_RESET_SAVEPOINT}`,
      );
    } catch (_rollbackError) {
      // Outer transaction may already be unusable; caller still rolls back.
    }
    log(
      `Could not reset personal workspace for ${fixtureUser.email}: ${
        error instanceof Error ? error.message : String(error)
      }. Other fixtures still commit.`,
    );
    return { reset: false };
  }
}

/**
 * @param {string[]} failedEmails
 */
export function throwIfZeroWorkspaceResetFailed(failedEmails) {
  if (failedEmails.length === 0) {
    return;
  }
  throw new Error(
    `Auth fixtures committed, but personal workspace reset failed for: ${failedEmails.join(", ")}. Re-seed after deleting jobs/tasks on those workspaces, or reset the agent branch.`,
  );
}

/**
 * Restore the no-organization contract for opt-out fixtures (zero).
 *
 * @param {import("pg").PoolClient | import("pg").Client} client
 * @param {{ userId: string }} fixtureUser
 * @param {SharedTable} sharedTable
 */
export async function clearUnwantedOrganizationMemberships(
  client,
  fixtureUser,
  sharedTable,
) {
  await client.query(
    `DELETE FROM ${sharedTable("member")} WHERE "userId" = $1`,
    [fixtureUser.userId],
  );
  await client.query(
    `UPDATE ${sharedTable("user")} SET "preferredOrganizationId" = NULL WHERE id = $1`,
    [fixtureUser.userId],
  );
  await client.query(
    `UPDATE ${sharedTable("session")} SET "activeOrganizationId" = NULL WHERE "userId" = $1`,
    [fixtureUser.userId],
  );
}

/**
 * Resolve packages that live under apps/core (not hoisted to root).
 * @param {string} specifier
 */
async function importFromCore(specifier) {
  const require = createRequire(
    path.join(REPO_ROOT, "apps", "core", "package.json"),
  );
  const resolved = require.resolve(specifier);
  return import(resolved);
}

/**
 * @param {import("pg").PoolClient | import("pg").Client} client
 * @param {object} fixture
 * @param {string} passwordHash
 * @param {SharedTable} sharedTable
 */
async function upsertFixtureUser(client, fixture, passwordHash, sharedTable) {
  const existing = await client.query(
    `SELECT id FROM ${sharedTable("user")} WHERE email = $1 LIMIT 1`,
    [fixture.email],
  );

  const now = new Date();
  let userId;

  if (existing.rowCount && existing.rows[0]?.id) {
    userId = existing.rows[0].id;
    await client.query(
      `UPDATE ${sharedTable("user")}
       SET name = $2,
           "emailVerified" = true,
           role = $3,
           banned = false,
           "updatedAt" = $4,
           "termsAccepted" = true
       WHERE id = $1`,
      [userId, fixture.name, fixture.role, now],
    );
  } else {
    userId = randomUUID();
    await client.query(
      `INSERT INTO ${sharedTable("user")} (
         id, name, email, "emailVerified", role, "createdAt", "updatedAt",
         "marketingOptIn", "termsAccepted", "notificationsOptIn"
       ) VALUES ($1, $2, $3, true, $4, $5, $5, false, true, true)`,
      [userId, fixture.name, fixture.email, fixture.role, now],
    );
  }

  const account = await client.query(
    `SELECT id FROM ${sharedTable("account")}
     WHERE "userId" = $1 AND "providerId" = 'credential'
     LIMIT 1`,
    [userId],
  );

  if (account.rowCount && account.rows[0]?.id) {
    await client.query(
      `UPDATE ${sharedTable("account")}
       SET password = $2,
           "accountId" = $3,
           "updatedAt" = $4
       WHERE id = $1`,
      [account.rows[0].id, passwordHash, userId, now],
    );
  } else {
    await client.query(
      `INSERT INTO ${sharedTable("account")} (
         id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt"
       ) VALUES ($1, $2, 'credential', $2, $3, $4, $4)`,
      [randomUUID(), userId, passwordHash, now],
    );
  }

  if (fixtureWantsPersonalWorkspace(fixture)) {
    await client.query(
      `INSERT INTO ${sharedTable("workspace")} (id, "userId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $3)
       ON CONFLICT ("userId") DO NOTHING`,
      [randomUUID(), userId, now],
    );
    return { userId, personalWorkspaceReset: null };
  }

  // Keep zero-workspace fixtures durable across re-seed after accidental
  // lazy-create (workspace middleware upsert on other Core routes).
  const reset = await resetUnwantedPersonalWorkspace(
    client,
    { userId, email: fixture.email },
    sharedTable,
  );
  return { userId, personalWorkspaceReset: reset.reset };
}

/**
 * Ensure each fixture user owns at least one organization (member role owner)
 * plus an organization workspace. Idempotent on organization.slug.
 *
 * @param {import("pg").PoolClient | import("pg").Client} client
 * @param {string} userId
 * @param {{ name: string, slug: string }} organization
 * @param {SharedTable} sharedTable
 */
async function upsertFixtureOrganization(
  client,
  userId,
  organization,
  sharedTable,
) {
  const now = new Date();

  const existing = await client.query(
    `SELECT id FROM ${sharedTable("organization")} WHERE slug = $1 LIMIT 1`,
    [organization.slug],
  );

  let organizationId;
  if (existing.rowCount && existing.rows[0]?.id) {
    organizationId = existing.rows[0].id;
    await client.query(
      `UPDATE ${sharedTable("organization")}
       SET name = $2
       WHERE id = $1`,
      [organizationId, organization.name],
    );
  } else {
    organizationId = randomUUID();
    await client.query(
      `INSERT INTO ${sharedTable("organization")} (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, $4)`,
      [organizationId, organization.name, organization.slug, now],
    );
  }

  await client.query(
    `INSERT INTO ${sharedTable("member")} (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, 'owner', $4)
     ON CONFLICT ("userId", "organizationId") DO UPDATE
       SET role = 'owner'`,
    [randomUUID(), userId, organizationId, now],
  );

  await client.query(
    `INSERT INTO ${sharedTable("workspace")} (id, "organizationId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $3)
     ON CONFLICT ("organizationId") DO NOTHING`,
    [randomUUID(), organizationId, now],
  );

  return organizationId;
}

/**
 * The database to seed and the variables that name its layout. The two come
 * from the same place: a provisioned agent branch is migrated on today's
 * layout (all `public`), so schema names exported in the shell describe
 * another database. That is the URL the provisioner passes, and the URL
 * `with-db.mjs` puts into the environment from the provisioned URLs file. Any
 * other URL from the environment takes its layout from the environment.
 *
 * @param {string | undefined} passedUrl
 * @param {Record<string, string | undefined>} env
 * @param {{ databaseUrl: string, databaseUrlUnpooled: string } | null} provisioned
 * @returns {{ databaseUrl: string, layoutEnv: Record<string, string | undefined> }}
 */
export function seedDatabase(passedUrl, env, provisioned) {
  const passed = passedUrl?.trim();
  const databaseUrl =
    passed ||
    env.DATABASE_URL_UNPOOLED?.trim() ||
    env.DATABASE_URL?.trim() ||
    "";
  const isProvisioned =
    Boolean(passed) ||
    (databaseUrl !== "" &&
      [provisioned?.databaseUrl, provisioned?.databaseUrlUnpooled].includes(
        databaseUrl,
      ));
  return { databaseUrl, layoutEnv: isProvisioned ? {} : env };
}

/**
 * @param {{
 *   databaseUrl?: string, // a provisioned agent branch
 *   force?: boolean,
 * }} [options]
 */
export async function seedAuthFixtures(options = {}) {
  if (process.env.CLOUD_AGENT_DB_SKIP_FIXTURES === "1") {
    log("Skipping auth fixtures (CLOUD_AGENT_DB_SKIP_FIXTURES=1)");
    return { seeded: 0, skipped: true };
  }

  const state = await readState(REPO_ROOT);
  const { databaseUrl, layoutEnv } = seedDatabase(
    options.databaseUrl,
    process.env,
    await readUrlsFile(REPO_ROOT),
  );
  const force =
    options.force === true || process.env.CLOUD_AGENT_DB_FORCE === "1";

  assertAgentFixtureSafety({
    branchName: state?.branchName,
    databaseUrl,
    databaseUrlUnpooledHost: state?.databaseUrlUnpooledHost,
    force,
  });

  const sharedTable = await sharedTableFor(layoutEnv);

  const [{ hashPassword }, { default: pg }] = await Promise.all([
    importFromCore("better-auth/crypto"),
    importFromCore("pg"),
  ]);

  const passwordHash = await hashPassword(FIXTURE_PASSWORD);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("BEGIN");
    const failedPersonalResets = [];
    for (const fixture of AUTH_FIXTURES) {
      const { userId, personalWorkspaceReset } = await upsertFixtureUser(
        client,
        fixture,
        passwordHash,
        sharedTable,
      );
      if (personalWorkspaceReset === false) {
        failedPersonalResets.push(fixture.email);
      }
      const organization = fixture.organization;
      if (fixtureWantsOrganization(fixture) && organization) {
        const organizationId = await upsertFixtureOrganization(
          client,
          userId,
          organization,
          sharedTable,
        );
        log(
          `Auth fixture ready: ${fixture.email} (org ${organization.slug}=${organizationId})`,
        );
      } else {
        await clearUnwantedOrganizationMemberships(
          client,
          { userId },
          sharedTable,
        );
        log(
          `Auth fixture ready: ${fixture.email} (no personal workspace, no organization)`,
        );
      }
    }
    await client.query("COMMIT");
    throwIfZeroWorkspaceResetFailed(failedPersonalResets);
    return { seeded: AUTH_FIXTURES.length, skipped: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  try {
    const result = await seedAuthFixtures();
    if (!result.skipped) {
      log(
        `Seeded ${result.seeded} auth fixture(s); password: ${FIXTURE_PASSWORD}`,
      );
    }
  } catch (error) {
    console.error(
      `[agent-db] error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  await main();
}
