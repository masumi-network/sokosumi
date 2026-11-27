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
 *   CLOUD_AGENT_DB_FORCE=1 (run outside Cursor agent; `pnpm db:up` sets it)
 *   CLOUD_AGENT_DB_SKIP_MIGRATE=1
 */

import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  injectShellRc,
  patchAppEnvFiles,
  removeLegacyState,
  writeEnvFile,
  writeState,
} from "./apply-env.mjs";
import { assertAgentBranchSafety } from "./assert-agent-database.mjs";
import {
  agentBranchName,
  expiresAtIso,
  isAgentBranchName,
  isAgentRunId,
} from "./names.mjs";
import {
  assertBranchConnectionUrls,
  createBranch,
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
  console.log(`[agent-db] ${message}`);
}

function warn(message) {
  console.warn(`[agent-db] ${message}`);
}

function fail(message) {
  console.error(`[agent-db] error: ${message}`);
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

async function ensureBranch(config, branchName, parent) {
  const existing = await findBranchByName(config, branchName);
  if (existing) {
    return { branch: existing, reused: true };
  }

  log(
    `Creating branch ${branchName} from parent ${parent.name} (${parent.id})`,
  );

  let created;
  try {
    created = await createBranch(config, {
      name: branchName,
      parentId: parent.id,
      expiresAt: expiresAtIso(),
    });
  } catch (error) {
    // Race: another provision created the same name
    // @ts-expect-error status from neonFetch
    if (error.status === 409 || /already exists/i.test(error.message)) {
      const raced = await findBranchByName(config, branchName);
      if (raced) {
        return { branch: raced, reused: true };
      }
    }
    throw error;
  }

  if (!created?.branch?.id) {
    throw new Error("Neon create branch response missing branch.id");
  }

  return { branch: created.branch, reused: false };
}

export async function provisionAgentBranch(config, branchName) {
  const parent = await resolveParentBranch(config, isAgentBranchName);
  const { branch, reused } = await ensureBranch(config, branchName, parent);
  let urls;
  try {
    urls = await getBranchConnectionUrls(config, branch.id);
  } catch (error) {
    if (!reused) {
      assertAgentBranchSafety(branch, branchName, parent.id);
      warn(`Connection URI failed; deleting orphan branch ${branchName}`);
      try {
        await deleteBranch(config, branch.id);
      } catch (cleanupError) {
        warn(`Failed to delete orphan branch: ${cleanupError.message}`);
      }
    }
    throw error;
  }

  assertAgentBranchSafety(branch, branchName, parent.id);
  const databaseUrlUnpooledHost = await assertBranchConnectionUrls(
    config,
    branch,
    urls,
  );
  if (reused) {
    log(`Reusing branch ${branchName} (${branch.id}); refreshing TTL`);
    await refreshBranchExpiration(config, branch.id, {
      expiresAt: expiresAtIso(),
    });
  }
  return { branchId: branch.id, reused, urls, databaseUrlUnpooledHost };
}

/** @param {{ databaseUrl: string, databaseUrlUnpooled: string }} urls */
function runMigrations(urls) {
  if (process.env.CLOUD_AGENT_DB_SKIP_MIGRATE === "1") {
    log("Skipping migrations (CLOUD_AGENT_DB_SKIP_MIGRATE=1)");
    return;
  }

  log("Applying pending Prisma migrations");
  const result = spawnSync("pnpm", ["prisma:migrate:deploy"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: urls.databaseUrl,
      DATABASE_URL_UNPOOLED: urls.databaseUrlUnpooled,
    },
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
        "Add them as Cursor Cloud secrets (see docs/agents/agent-database.md).",
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

  try {
    const { branchId, reused, urls, databaseUrlUnpooledHost } =
      await provisionAgentBranch(config, branchName);

    const state = {
      agentId,
      branchName,
      branchId,
      parentBranchName: config.parentBranchName,
      projectId: config.projectId,
      databaseUrlHost: safeHost(urls.databaseUrl),
      databaseUrlUnpooledHost,
      provisionedAt: new Date().toISOString(),
      expiresAt: expiresAtIso(),
      reused,
    };

    await writeState(REPO_ROOT, state);
    await writeEnvFile(REPO_ROOT, urls);
    await removeLegacyState(REPO_ROOT);
    await patchAppEnvFiles(REPO_ROOT, urls);

    // Cursor VMs hold one checkout. Elsewhere real env vars beat `.env`, so
    // an rc block would point every worktree's shell at this checkout.
    if (process.env.CURSOR_AGENT === "1") {
      const home = os.homedir();
      await injectShellRc(path.join(home, ".bashrc"), REPO_ROOT);
      await injectShellRc(path.join(home, ".profile"), REPO_ROOT);
    }

    runMigrations(urls);
    await runAuthFixtures(urls.databaseUrlUnpooled);

    log(
      `Ready: branch ${branchName} (${branchId})` +
        (reused ? " [reused]" : " [created]"),
    );
    log("Use: node scripts/agent-db/with-db.mjs -- <command>");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Upsert known login users on the agent branch only.
 * @param {string} databaseUrl
 */
async function runAuthFixtures(databaseUrl) {
  if (process.env.CLOUD_AGENT_DB_SKIP_FIXTURES === "1") {
    log("Skipping auth fixtures (CLOUD_AGENT_DB_SKIP_FIXTURES=1)");
    return;
  }

  log("Seeding guarded auth fixtures");
  const { seedAuthFixtures } = await import("./seed-auth-fixtures.mjs");
  const result = await seedAuthFixtures({ databaseUrl });
  if (!result.skipped) {
    log(
      `Auth fixtures ready (${result.seeded}); see docs/agents/agent-database.md`,
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

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  await main();
}
