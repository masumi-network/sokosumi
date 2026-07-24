#!/usr/bin/env node
/**
 * Tear down Cloud agent Neon branch(es).
 *
 * Only deletes branches named cloud-agent-* (never production/main parent).
 *
 * Usage:
 *   node scripts/cloud-agent-db/teardown.mjs
 *   node scripts/cloud-agent-db/teardown.mjs --agent-id bc-…
 *   node scripts/cloud-agent-db/teardown.mjs --branch-name cloud-agent-bc-…
 *   node scripts/cloud-agent-db/teardown.mjs --from-text "$PR_BODY"
 *   node scripts/cloud-agent-db/teardown.mjs --idle-gc
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { clearState, readState } from "./apply-env.mjs";
import {
  agentBranchName,
  extractAgentIdsFromText,
  isAgentBranchName,
  isIdlePastTtl,
} from "./names.mjs";
import {
  deleteBranch,
  findBranchByName,
  listBranches,
  readNeonConfig,
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

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ agentIds: string[], branchNames: string[], fromText: string | null, idleGc: boolean, help: boolean }} */
  const opts = {
    agentIds: [],
    branchNames: [],
    fromText: null,
    idleGc: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--idle-gc") opts.idleGc = true;
    else if (arg === "--agent-id") opts.agentIds.push(argv[++i] ?? "");
    else if (arg === "--branch-name") opts.branchNames.push(argv[++i] ?? "");
    else if (arg === "--from-text") opts.fromText = argv[++i] ?? "";
    else if (arg.startsWith("--agent-id="))
      opts.agentIds.push(arg.slice("--agent-id=".length));
    else if (arg.startsWith("--branch-name="))
      opts.branchNames.push(arg.slice("--branch-name=".length));
    else if (arg.startsWith("--from-text="))
      opts.fromText = arg.slice("--from-text=".length);
    else {
      fail(`Unknown argument: ${arg}`);
      opts.help = true;
    }
  }

  return opts;
}

function printHelp() {
  console.log(`Usage:
  node scripts/cloud-agent-db/teardown.mjs
  node scripts/cloud-agent-db/teardown.mjs --agent-id <bc-…>
  node scripts/cloud-agent-db/teardown.mjs --branch-name cloud-agent-<bc-…>
  node scripts/cloud-agent-db/teardown.mjs --from-text "<pr body>"
  node scripts/cloud-agent-db/teardown.mjs --idle-gc
`);
}

/**
 * @param {import("./neon-api.mjs").NeonConfig} config
 * @param {object} branch
 */
async function safeDeleteBranch(config, branch) {
  if (!isAgentBranchName(branch.name)) {
    warn(`Refusing to delete non-agent branch "${branch.name}"`);
    return false;
  }
  if (branch.default === true || branch.protected === true) {
    warn(`Refusing to delete protected/default branch "${branch.name}"`);
    return false;
  }

  log(`Deleting branch ${branch.name} (${branch.id})`);
  await deleteBranch(config, branch.id);
  return true;
}

/**
 * @param {import("./neon-api.mjs").NeonConfig} config
 * @param {string} branchName
 */
async function deleteByName(config, branchName) {
  if (!isAgentBranchName(branchName)) {
    warn(`Refusing to delete non-agent branch name "${branchName}"`);
    return false;
  }
  const branch = await findBranchByName(config, branchName);
  if (!branch) {
    log(`Branch ${branchName} not found (already gone)`);
    return false;
  }
  return safeDeleteBranch(config, branch);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const config = readNeonConfig();
  if (!config) {
    warn("NEON_API_KEY / NEON_PROJECT_ID unset — skip teardown");
    return;
  }

  /** @type {Set<string>} */
  const branchNames = new Set(
    opts.branchNames.map((name) => name.trim()).filter(Boolean),
  );

  for (const agentId of opts.agentIds) {
    if (agentId.trim()) branchNames.add(agentBranchName(agentId.trim()));
  }

  if (opts.fromText) {
    for (const agentId of extractAgentIdsFromText(opts.fromText)) {
      branchNames.add(agentBranchName(agentId));
    }
  }

  const state = await readState(REPO_ROOT);
  const useStateFallback =
    branchNames.size === 0 && !opts.idleGc && !opts.fromText;

  if (useStateFallback && state?.branchName) {
    branchNames.add(state.branchName);
  }

  if (
    useStateFallback &&
    branchNames.size === 0 &&
    process.env.CURSOR_CONVERSATION_ID
  ) {
    branchNames.add(agentBranchName(process.env.CURSOR_CONVERSATION_ID));
  }

  let deleted = 0;

  try {
    if (opts.idleGc) {
      const branches = await listBranches(config);
      for (const branch of branches) {
        if (!isAgentBranchName(branch.name)) continue;
        if (branch.default === true || branch.protected === true) continue;
        // Honor Neon expires_at (refreshed on resume). created_at alone would
        // delete active agent DBs after 72h from create despite TTL refresh.
        if (
          !isIdlePastTtl({
            expiresAt: branch.expires_at,
            createdAt: branch.created_at,
          })
        ) {
          continue;
        }
        if (await safeDeleteBranch(config, branch)) deleted += 1;
      }
    }

    for (const name of branchNames) {
      if (await deleteByName(config, name)) deleted += 1;
    }

    if (
      state?.branchName &&
      (branchNames.has(state.branchName) || opts.idleGc)
    ) {
      await clearState(REPO_ROOT);
    }

    if (deleted === 0 && branchNames.size === 0 && !opts.idleGc) {
      warn("Nothing to tear down (no agent id / branch / PR text / state)");
    } else {
      log(`Teardown complete (${deleted} branch(es) deleted)`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

await main();
