#!/usr/bin/env node
/**
 * Tear down Cloud agent Neon branch(es).
 *
 * Only deletes branches named cloud-agent-* (never production/main parent).
 * Idle expiry is owned by Neon `expires_at` (set/refreshed on provision) —
 * this script does not sweep expired branches.
 *
 * Usage:
 *   node scripts/cloud-agent-db/teardown.mjs
 *   node scripts/cloud-agent-db/teardown.mjs --agent-id bc-…
 *   node scripts/cloud-agent-db/teardown.mjs --branch-name cloud-agent-bc-…
 *   node scripts/cloud-agent-db/teardown.mjs --from-text "<pr body>"
 *   node scripts/cloud-agent-db/teardown.mjs --from-workflow-run
 *   node scripts/cloud-agent-db/teardown.mjs --from-agent-id-env
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { clearState, readState } from "./apply-env.mjs";
import {
  agentBranchName,
  extractAgentIdsFromText,
  isAgentBranchName,
} from "./names.mjs";
import { deleteBranch, findBranchByName, readNeonConfig } from "./neon-api.mjs";

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
 * @param {NodeJS.ProcessEnv} [env]
 */
export function parseArgs(argv, env = process.env) {
  /** @type {{ agentIds: string[], branchNames: string[], fromText: string | null, fromWorkflowRun: boolean, help: boolean }} */
  const opts = {
    agentIds: [],
    branchNames: [],
    fromText: null,
    fromWorkflowRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--agent-id") opts.agentIds.push(argv[++i] ?? "");
    else if (arg === "--branch-name") opts.branchNames.push(argv[++i] ?? "");
    else if (arg === "--from-text") opts.fromText = argv[++i] ?? "";
    else if (arg === "--from-workflow-run") opts.fromWorkflowRun = true;
    else if (arg === "--from-agent-id-env") {
      opts.agentIds.push(env.AGENT_ID ?? "");
    } else if (arg.startsWith("--agent-id="))
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
  node scripts/cloud-agent-db/teardown.mjs --from-workflow-run
  node scripts/cloud-agent-db/teardown.mjs --from-agent-id-env
`);
}

/**
 * @param {string} token
 */
function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "sokosumi-cloud-agent-db-teardown",
  };
}

/**
 * @param {object} options
 * @param {string} options.token
 * @param {string} options.url
 * @param {typeof fetch} [options.fetchImpl]
 */
export async function githubJson({ token, url, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(url, { headers: githubHeaders(token) });
  if (response.status === 404) {
    return null;
  }
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`GitHub ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

/**
 * Same-repo PR bodies for the workflow_run that just completed. Fork PRs
 * are skipped so a close event cannot name someone else's agent id.
 *
 * Closed runs list no pulls, and commits/{sha}/pulls omits PRs closed
 * without merging, so the "PR closed" run-name (display_title, the PR
 * number) is tried first. It comes from head YAML, so every candidate must
 * have the run's head SHA as its head.
 *
 * @param {object} options
 * @param {string} options.token
 * @param {string} options.repo
 * @param {string} options.runId
 * @param {string} [options.headSha]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<string[]>}
 */
export async function sameRepoPullRequestBodies({
  token,
  repo,
  runId,
  headSha,
  fetchImpl = globalThis.fetch,
}) {
  if (!token || !repo || !runId) {
    throw new Error("GH_TOKEN, GH_REPO, and WORKFLOW_RUN_ID are required");
  }

  const run = await githubJson({
    token,
    url: `https://api.github.com/repos/${repo}/actions/runs/${runId}`,
    fetchImpl,
  });
  /** @type {{ number?: number }[]} */
  let pullRequests = Array.isArray(run?.pull_requests) ? run.pull_requests : [];

  const titleNumber = Number(run?.display_title);
  if (
    pullRequests.length === 0 &&
    headSha &&
    Number.isSafeInteger(titleNumber) &&
    titleNumber > 0
  ) {
    pullRequests = [{ number: titleNumber }];
  }

  if (pullRequests.length === 0 && headSha) {
    const associated = await githubJson({
      token,
      url: `https://api.github.com/repos/${repo}/commits/${headSha}/pulls`,
      fetchImpl,
    });
    pullRequests = Array.isArray(associated) ? associated : [];
  }

  const bodies = [];
  for (const entry of pullRequests) {
    if (!entry?.number) continue;
    const pullRequest = await githubJson({
      token,
      url: `https://api.github.com/repos/${repo}/pulls/${entry.number}`,
      fetchImpl,
    });
    if (!pullRequest) continue;
    if (pullRequest.head?.repo?.full_name !== repo) {
      warn(
        `Skipping fork pull request ${entry.number} (head ${pullRequest.head?.repo?.full_name ?? "unknown"})`,
      );
      continue;
    }
    if (headSha && pullRequest.head?.sha !== headSha) {
      warn(
        `Skipping pull request ${entry.number} (head ${pullRequest.head?.sha ?? "unknown"} is not ${headSha})`,
      );
      continue;
    }
    bodies.push(typeof pullRequest.body === "string" ? pullRequest.body : "");
  }
  return bodies;
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

export function isMainModule(moduleUrl = import.meta.url) {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return pathToFileURL(path.resolve(entry)).href === moduleUrl;
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

  if (opts.fromWorkflowRun) {
    const bodies = await sameRepoPullRequestBodies({
      token: process.env.GH_TOKEN ?? "",
      repo: process.env.GH_REPO ?? "",
      runId: process.env.WORKFLOW_RUN_ID ?? "",
      headSha: process.env.HEAD_SHA,
    });
    for (const body of bodies) {
      for (const agentId of extractAgentIdsFromText(body)) {
        branchNames.add(agentBranchName(agentId));
      }
    }
  }

  const state = await readState(REPO_ROOT);
  const useStateFallback =
    branchNames.size === 0 && !opts.fromText && !opts.fromWorkflowRun;

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
    for (const name of branchNames) {
      if (await deleteByName(config, name)) deleted += 1;
    }

    if (state?.branchName && branchNames.has(state.branchName)) {
      await clearState(REPO_ROOT);
    }

    if (deleted === 0 && branchNames.size === 0) {
      warn("Nothing to tear down (no agent id / branch / PR text / state)");
    } else {
      log(`Teardown complete (${deleted} branch(es) deleted)`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

if (isMainModule()) {
  await main();
}
