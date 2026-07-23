#!/usr/bin/env node
/**
 * Provision an ephemeral Neon branch for this Cloud agent run.
 *
 * Forks from NEON_PARENT_BRANCH (default: main), never from another agent branch.
 * Sets expires_at to now+72h. Writes DATABASE_URL / DATABASE_URL_UNPOOLED and
 * applies pending Prisma migrations.
 *
 * Required secrets (Cursor Cloud Runtime Secrets / GitHub Actions):
 *   NEON_API_KEY, NEON_PROJECT_ID
 * Optional:
 *   NEON_PARENT_BRANCH (default main)
 *   NEON_DATABASE_NAME (default neondb)
 *   NEON_ROLE_NAME (default neondb_owner)
 *   CLOUD_AGENT_RUN_ID (override agent id; default CURSOR_CONVERSATION_ID)
 *   CLOUD_AGENT_DB_FORCE=1 (run outside Cursor agent)
 *   CLOUD_AGENT_DB_SKIP_MIGRATE=1
 */

import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyUrlsToProcessEnv,
  injectShellRc,
  patchAppEnvFiles,
  writeEnvFile,
  writeState,
} from "./apply-env.mjs";
import {
  agentBranchName,
  expiresAtIso,
  isAgentBranchName,
  isAgentRunId,
} from "./names.mjs";
import {
  createAgentBranch,
  deleteBranch,
  findBranchByName,
  getBranchConnectionUrls,
  readNeonConfig,
  refreshBranchExpiration,
  resolveParentBranch,
} from "./neon-api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

function log(message) {
  console.log(`[cloud-agent-db] ${message}`);
}

function warn(message) {
  console.warn(`[cloud-agent-db] ${message}`);
}

function fail(message) {
  console.error(`[cloud-agent-db] error: ${message}`);
  process.exitCode = 1;
}

function resolveAgentId(env = process.env) {
  const explicit =
    env.CLOUD_AGENT_RUN_ID?.trim() || env.CURSOR_CONVERSATION_ID?.trim();
  if (explicit && isAgentRunId(explicit)) return explicit.toLowerCase();
  if (explicit) return explicit.trim();
  return null;
}

function shouldProvision(env = process.env) {
  if (env.CLOUD_AGENT_DB_FORCE === "1") return true;
  return env.CURSOR_AGENT === "1";
}

async function ensureBranch(config, branchName) {
  const existing = await findBranchByName(config, branchName);
  const expiresAt = expiresAtIso();

  if (existing) {
    log(`Reusing branch ${branchName} (${existing.id}); refreshing TTL`);
    await refreshBranchExpiration(config, existing.id, { expiresAt });
    return { branchId: existing.id, branchName, reused: true };
  }

  const parent = await resolveParentBranch(config, isAgentBranchName);
  log(
    `Creating branch ${branchName} from parent ${parent.name} (${parent.id})`,
  );

  let created;
  try {
    created = await createAgentBranch(config, {
      name: branchName,
      parentId: parent.id,
      expiresAt,
    });
  } catch (error) {
    // Race: another provision created the same name
    // @ts-expect-error status from neonFetch
    if (error.status === 409 || /already exists/i.test(error.message)) {
      const raced = await findBranchByName(config, branchName);
      if (raced) {
        await refreshBranchExpiration(config, raced.id, { expiresAt });
        return { branchId: raced.id, branchName, reused: true };
      }
    }
    throw error;
  }

  const branchId = created?.branch?.id;
  if (!branchId) {
    throw new Error("Neon create branch response missing branch.id");
  }

  return { branchId, branchName, reused: false, created };
}

async function connectionUrlsOrCleanup(config, branchMeta) {
  try {
    return await getBranchConnectionUrls(config, branchMeta.branchId);
  } catch (error) {
    if (!branchMeta.reused) {
      warn(
        `Connection URI failed; deleting orphan branch ${branchMeta.branchName}`,
      );
      try {
        await deleteBranch(config, branchMeta.branchId);
      } catch (cleanupError) {
        warn(`Failed to delete orphan branch: ${cleanupError.message}`);
      }
    }
    throw error;
  }
}

function runMigrations() {
  if (process.env.CLOUD_AGENT_DB_SKIP_MIGRATE === "1") {
    log("Skipping migrations (CLOUD_AGENT_DB_SKIP_MIGRATE=1)");
    return;
  }

  log("Applying pending Prisma migrations");
  const result = spawnSync("pnpm", ["prisma:migrate:deploy"], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy exited with code ${result.status}`);
  }
}

async function main() {
  if (!shouldProvision()) {
    log("Not a Cloud agent run (CURSOR_AGENT!=1); skipping provision");
    return;
  }

  const config = readNeonConfig();
  if (!config) {
    warn(
      "NEON_API_KEY / NEON_PROJECT_ID unset — skip agent DB provision. " +
        "Add them as Cursor Cloud secrets (see docs/agents/cloud-agent-database.md).",
    );
    return;
  }

  const agentId = resolveAgentId();
  if (!agentId) {
    fail(
      "CURSOR_CONVERSATION_ID / CLOUD_AGENT_RUN_ID missing; cannot name agent branch",
    );
    return;
  }

  if (!isAgentRunId(agentId)) {
    warn(
      `Agent id "${agentId}" is non-standard; proceeding with sanitized branch name`,
    );
  }

  const branchName = agentBranchName(agentId);
  if (!isAgentBranchName(branchName)) {
    fail(`Internal error: invalid agent branch name ${branchName}`);
    return;
  }

  let branchMeta;
  try {
    branchMeta = await ensureBranch(config, branchName);
    const urls = await connectionUrlsOrCleanup(config, branchMeta);
    applyUrlsToProcessEnv(urls);

    const state = {
      agentId,
      branchName,
      branchId: branchMeta.branchId,
      parentBranchName: config.parentBranchName,
      projectId: config.projectId,
      databaseUrlHost: safeHost(urls.databaseUrl),
      provisionedAt: new Date().toISOString(),
      expiresAt: expiresAtIso(),
      reused: branchMeta.reused,
    };

    await writeState(REPO_ROOT, state);
    await writeEnvFile(REPO_ROOT, urls);
    await patchAppEnvFiles(REPO_ROOT, urls);

    const home = os.homedir();
    await injectShellRc(path.join(home, ".bashrc"), REPO_ROOT);
    await injectShellRc(path.join(home, ".profile"), REPO_ROOT);

    runMigrations();
    await runAuthFixtures({ branchName });

    log(
      `Ready: branch ${branchName} (${branchMeta.branchId})` +
        (branchMeta.reused ? " [reused]" : " [created]"),
    );
    log("Use: node scripts/cloud-agent-db/with-db.mjs -- <command>");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Upsert known login users on the agent branch only.
 * @param {{ branchName: string }} input
 */
async function runAuthFixtures(input) {
  if (process.env.CLOUD_AGENT_DB_SKIP_FIXTURES === "1") {
    log("Skipping auth fixtures (CLOUD_AGENT_DB_SKIP_FIXTURES=1)");
    return;
  }

  log("Seeding guarded auth fixtures");
  const { seedAuthFixtures } = await import("./seed-auth-fixtures.mjs");
  const result = await seedAuthFixtures({
    branchName: input.branchName,
    databaseUrl: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
  });
  if (!result.skipped) {
    log(
      `Auth fixtures ready (${result.seeded}); see docs/agents/cloud-agent-database.md`,
    );
  }
}

/**
 * @param {string} url
 */
function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

await main();
