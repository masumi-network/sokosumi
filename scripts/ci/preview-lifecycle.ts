import { appendFile } from "node:fs/promises";

import {
  assertPreviewBranchResettable,
  findBranchByName,
  listBranches,
  refreshBranchExpiration,
} from "../cloud-agent-db/neon-api.mjs";
import {
  cleanupPreviewResources,
  PREVIEW_TTL_MS,
  type PreviewOptions,
  previewBranchName,
  previewNeonConfigs,
  vercelRequest,
} from "./preview-resources.ts";
import {
  deployTargets,
  githubJson,
  isMainModule,
  readActionsContext,
} from "./vercel-deploy.mjs";

interface LifecycleOptions extends Omit<PreviewOptions, "ref"> {
  githubToken: string;
  repoOwner: string;
  repoName: string;
}

export async function cleanupClosedPreview(options: LifecycleOptions) {
  // Read current state inside the same per-PR queue as deploy/reset. An old
  // close event must not delete a preview after the PR has been reopened.
  const pull = await githubJson(
    options.fetchImpl ?? fetch,
    options.githubToken,
    `https://api.github.com/repos/${options.repoOwner}/${options.repoName}/pulls/${options.pullNumber}`,
  );
  if (!pull) throw new Error("Cannot verify PR ownership for preview cleanup");
  if (
    pull.state !== "closed" ||
    pull.base.repo.id !== options.repoId ||
    pull.head.repo?.id !== options.repoId
  ) {
    return { kind: "skip" };
  }
  return cleanupPreviewResources(
    { ...options, ref: pull.head.ref },
    deployTargets(["mainnet", "preprod"]),
  );
}

export async function renewOpenPreview(options: LifecycleOptions) {
  const pull = await githubJson(
    options.fetchImpl ?? fetch,
    options.githubToken,
    `https://api.github.com/repos/${options.repoOwner}/${options.repoName}/pulls/${options.pullNumber}`,
  );
  if (!pull) throw new Error("Cannot verify PR ownership for preview renewal");
  if (
    pull.state !== "open" ||
    pull.base.repo.id !== options.repoId ||
    pull.head.repo?.id !== options.repoId
  ) {
    return { kind: "skip" };
  }
  const name = previewBranchName(options);
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS).toISOString();
  let renewed = 0;
  for (const { config } of previewNeonConfigs(options, [
    "mainnet",
    "preprod",
  ])) {
    const branch = await findBranchByName(config, name);
    // Commit activity extends an existing preview; it never creates one or deploys.
    if (!branch) continue;
    assertPreviewBranchResettable(branch);
    try {
      await refreshBranchExpiration(config, branch.id, { expiresAt });
      renewed++;
    } catch (error) {
      // Neon expiry may win between lookup and renewal. A later /deploy recreates it.
      if (
        !(error instanceof Error) ||
        !("status" in error) ||
        error.status !== 404
      )
        throw error;
    }
  }
  return { kind: "renew", branches: renewed };
}

export async function previewCleanupInventory(
  options: Omit<LifecycleOptions, "pullNumber">,
) {
  const numbers = new Set<number>();
  const pattern = new RegExp(`^preview/gh-${options.repoId}-pr-([1-9][0-9]*)$`);
  for (const { config } of previewNeonConfigs(options, [
    "mainnet",
    "preprod",
  ])) {
    for (const branch of await listBranches(
      config,
      `preview/gh-${options.repoId}-pr-`,
    )) {
      const match = branch.name.match(pattern);
      if (match) numbers.add(Number(match[1]));
    }
  }
  // Native Neon expiry can remove a branch before the close event reaches us.
  // Its Vercel env marker keeps that PR discoverable for daily reconciliation.
  for (const target of deployTargets(["mainnet", "preprod"], ["core"])) {
    const result = await vercelRequest(
      options,
      `/v10/projects/${target.projectId}/env`,
    );
    if (!Array.isArray(result?.envs))
      throw new Error("Vercel environment list is missing");
    for (const env of result.envs) {
      const match = String(env.comment ?? "")
        .replace(/^GitHub-managed /, "")
        .match(pattern);
      if (match) numbers.add(Number(match[1]));
    }
  }
  const closed: number[] = [];
  for (const pullNumber of [...numbers].sort((a, b) => a - b)) {
    const pull = await githubJson(
      options.fetchImpl ?? fetch,
      options.githubToken,
      `https://api.github.com/repos/${options.repoOwner}/${options.repoName}/pulls/${pullNumber}`,
    );
    // A missing PR cannot authorize deletion, but must not block other PRs.
    if (!pull) continue;
    if (
      pull.state === "closed" &&
      pull.base.repo.id === options.repoId &&
      pull.head.repo?.id === options.repoId
    )
      closed.push(pullNumber);
    // GitHub limits a matrix to 256 jobs. Successfully deleted resources drop
    // out of tomorrow's inventory, so larger backlogs drain in daily batches.
    if (closed.length === 256) break;
  }
  return closed;
}

async function main() {
  const { event, ...context } = await readActionsContext();
  if (!context.vercelToken || !context.githubToken)
    throw new Error("VERCEL_TOKEN and GITHUB_TOKEN are required");
  const options = {
    ...context,
    vercelToken: context.vercelToken,
    githubToken: context.githubToken,
    neonEnv: process.env,
  };
  if (process.argv[2] === "inventory") {
    const numbers = await previewCleanupInventory(options);
    if (!process.env.GITHUB_OUTPUT)
      throw new Error("GITHUB_OUTPUT is required");
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `prs=${JSON.stringify(numbers)}\n`,
    );
    return;
  }
  const pullNumber = Number(
    process.env.PREVIEW_PR_NUMBER ?? event.pull_request?.number,
  );
  if (!Number.isSafeInteger(pullNumber) || pullNumber <= 0)
    throw new Error("A valid PR number is required");
  console.log(
    JSON.stringify(
      await (process.argv[2] === "renew"
        ? renewOpenPreview
        : cleanupClosedPreview)({ ...options, pullNumber }),
    ),
  );
}

if (isMainModule(import.meta.url)) await main();
