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
import { readState } from "./apply-env.mjs";
import {
  assertAgentFixtureSafety,
  checkAgentFixtureSafety,
} from "./assert-agent-database.mjs";
import { AUTH_FIXTURES, FIXTURE_PASSWORD } from "./fixtures.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

function log(message) {
  console.log(`[cloud-agent-db] ${message}`);
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
 */
async function upsertFixtureUser(client, fixture, passwordHash) {
  const existing = await client.query(
    `SELECT id FROM "user" WHERE email = $1 LIMIT 1`,
    [fixture.email],
  );

  const now = new Date();
  let userId;

  if (existing.rowCount && existing.rows[0]?.id) {
    userId = existing.rows[0].id;
    await client.query(
      `UPDATE "user"
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
      `INSERT INTO "user" (
         id, name, email, "emailVerified", role, "createdAt", "updatedAt",
         "marketingOptIn", "termsAccepted", "notificationsOptIn"
       ) VALUES ($1, $2, $3, true, $4, $5, $5, false, true, true)`,
      [userId, fixture.name, fixture.email, fixture.role, now],
    );
  }

  const account = await client.query(
    `SELECT id FROM account
     WHERE "userId" = $1 AND "providerId" = 'credential'
     LIMIT 1`,
    [userId],
  );

  if (account.rowCount && account.rows[0]?.id) {
    await client.query(
      `UPDATE account
       SET password = $2,
           "accountId" = $3,
           "updatedAt" = $4
       WHERE id = $1`,
      [account.rows[0].id, passwordHash, userId, now],
    );
  } else {
    await client.query(
      `INSERT INTO account (
         id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt"
       ) VALUES ($1, $2, 'credential', $2, $3, $4, $4)`,
      [randomUUID(), userId, passwordHash, now],
    );
  }

  await client.query(
    `INSERT INTO workspace (id, "userId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $3)
     ON CONFLICT ("userId") DO NOTHING`,
    [randomUUID(), userId, now],
  );

  return userId;
}

/**
 * Ensure each fixture user owns at least one organization (member role owner)
 * plus an organization workspace. Idempotent on organization.slug.
 *
 * @param {import("pg").PoolClient | import("pg").Client} client
 * @param {string} userId
 * @param {{ name: string, slug: string }} organization
 */
async function upsertFixtureOrganization(client, userId, organization) {
  const now = new Date();

  const existing = await client.query(
    `SELECT id FROM organization WHERE slug = $1 LIMIT 1`,
    [organization.slug],
  );

  let organizationId;
  if (existing.rowCount && existing.rows[0]?.id) {
    organizationId = existing.rows[0].id;
    await client.query(
      `UPDATE organization
       SET name = $2
       WHERE id = $1`,
      [organizationId, organization.name],
    );
  } else {
    organizationId = randomUUID();
    await client.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, $4)`,
      [organizationId, organization.name, organization.slug, now],
    );
  }

  await client.query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, 'owner', $4)
     ON CONFLICT ("userId", "organizationId") DO UPDATE
       SET role = 'owner'`,
    [randomUUID(), userId, organizationId, now],
  );

  await client.query(
    `INSERT INTO workspace (id, "organizationId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $3)
     ON CONFLICT ("organizationId") DO NOTHING`,
    [randomUUID(), organizationId, now],
  );

  return organizationId;
}

/**
 * @param {{
 *   databaseUrl?: string,
 *   branchName?: string | null,
 *   force?: boolean,
 * }} [options]
 */
export async function seedAuthFixtures(options = {}) {
  if (process.env.CLOUD_AGENT_DB_SKIP_FIXTURES === "1") {
    log("Skipping auth fixtures (CLOUD_AGENT_DB_SKIP_FIXTURES=1)");
    return { seeded: 0, skipped: true };
  }

  const state = await readState(REPO_ROOT);
  const databaseUrl =
    options.databaseUrl?.trim() ||
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "";
  const branchName = options.branchName ?? state?.branchName ?? null;
  const force =
    options.force === true || process.env.CLOUD_AGENT_DB_FORCE === "1";

  const safety = checkAgentFixtureSafety({
    branchName,
    databaseUrl,
    force,
  });
  assertAgentFixtureSafety(safety);

  const [{ hashPassword }, { default: pg }] = await Promise.all([
    importFromCore("better-auth/crypto"),
    importFromCore("pg"),
  ]);

  const passwordHash = await hashPassword(FIXTURE_PASSWORD);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("BEGIN");
    for (const fixture of AUTH_FIXTURES) {
      const userId = await upsertFixtureUser(client, fixture, passwordHash);
      const organizationId = await upsertFixtureOrganization(
        client,
        userId,
        fixture.organization,
      );
      log(
        `Auth fixture ready: ${fixture.email} (org ${fixture.organization.slug}=${organizationId})`,
      );
    }
    await client.query("COMMIT");
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
      `[cloud-agent-db] error: ${error instanceof Error ? error.message : String(error)}`,
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
