#!/usr/bin/env node
/**
 * Delete a closed pull request's Neon preview branch (`preview/<head ref>`)
 * in every preview project, and its Vercel preview deployments in every web
 * and Core project. Neon bills every extra branch per month, and nothing else
 * deletes these when the pull request closes.
 *
 * Nothing is deleted when the head is a fork (forks get no preview), when
 * the head is the default branch, or when another open pull request still
 * uses the same head ref.
 *
 *   HEAD_REF=feat/x HEAD_REPO=owner/repo node scripts/ci/preview-branch-teardown.mjs
 */

import {
  deleteBranch,
  findBranchByName,
  isNeonBusy,
  isUnknownNeonOutcome,
  neonErrorReason,
  PREVIEW_BRANCH_PREFIX,
  retryNeon,
} from "../cloud-agent-db/neon-api.mjs";
import {
  readPreviewNeonConfigs,
  withRequestTimeout,
} from "./preview-db-reset.mjs";
import {
  deleteVercelPreviews,
  errorMessage,
  NOT_FOUND_STATUS,
} from "./preview-vercel-teardown.mjs";
import {
  githubHeaders,
  isMainModule,
  NETWORKS,
  VERCEL_TEAM_ID,
} from "./vercel-deploy.mjs";

// A busy project (a `/reset-db` restore, a rate limit) answers 423/429/503.
// A timeout or other 5xx is retried too: a delete by id is safe to repeat,
// and a later 404 counts as done.
const DELETE_ATTEMPTS = 5;
// Longer than Neon's documented 100 ms lock retry: a `/reset-db` restore can
// hold the project for tens of seconds, and this job has no reply to post.
const DELETE_FIRST_DELAY_MS = 2000;

/** True when an open pull request of `repo` has `ref` as its head. */
export async function hasOpenPullRequest({ repo, ref, token, fetchImpl }) {
  const owner = repo.split("/")[0];
  const query = new URLSearchParams({ state: "open", head: `${owner}:${ref}` });
  const response = await fetchImpl(
    `https://api.github.com/repos/${repo}/pulls?${query}`,
    { headers: githubHeaders(token) },
  );
  if (!response.ok) {
    throw new Error(
      `GitHub pull request list failed (${response.status}): ${await response.text()}`,
    );
  }
  const pulls = await response.json();
  return pulls.length > 0;
}

/** @returns {Promise<boolean>} false when a lookup or delete failed */
async function deleteNeonBranches({
  neonConfigs,
  name,
  fetchImpl,
  log,
  sleep,
}) {
  let ok = true;
  for (const { network, config } of neonConfigs) {
    const neon = { ...config, fetchImpl };
    try {
      // A 404 here means a wrong project id, not a deleted branch.
      const branch = await findBranchByName(neon, name);
      if (!branch) {
        log(`${network}: ${name} not found (already gone)`);
        continue;
      }
      if (branch.default === true || branch.protected === true) {
        log(`${network}: refusing to delete protected/default ${name}`);
        continue;
      }
      try {
        await retryNeon(() => deleteBranch(neon, branch.id), {
          isRetryable: (error) =>
            isNeonBusy(error) || isUnknownNeonOutcome(error),
          attempts: DELETE_ATTEMPTS,
          firstDelayMs: DELETE_FIRST_DELAY_MS,
          sleep,
        });
      } catch (error) {
        if (error?.status !== NOT_FOUND_STATUS) throw error;
      }
      log(`${network}: deleted ${name}`);
    } catch (error) {
      ok = false;
      log(`${network}: failed to delete ${name}: ${neonErrorReason(error)}`);
    }
  }
  return ok;
}

/** @returns {Promise<boolean>} false when a lookup or delete failed */
export async function runPreviewTeardown({
  env = process.env,
  fetchImpl = fetch,
  log = console.log,
  sleep,
}) {
  const repo = env.GITHUB_REPOSITORY;
  const ref = env.HEAD_REF?.trim();
  if (!ref) {
    throw new Error("HEAD_REF is not set");
  }
  if (!env.VERCEL_TOKEN) {
    throw new Error("VERCEL_TOKEN is not set");
  }
  const neonConfigs = readPreviewNeonConfigs(env, NETWORKS);
  if (env.HEAD_REPO !== repo) {
    log(`Skipping fork head ${env.HEAD_REPO}:${ref}`);
    return true;
  }
  if (ref === env.DEFAULT_BRANCH) {
    log(`Skipping the default branch ${ref}`);
    return true;
  }

  const timedFetch = withRequestTimeout(fetchImpl);
  if (
    await hasOpenPullRequest({
      repo,
      ref,
      token: env.GH_TOKEN,
      fetchImpl: timedFetch,
    })
  ) {
    log(`Keeping preview resources for ${ref}: an open pull request uses it`);
    return true;
  }

  // Neon and Vercel are independent. Run them together, so a slow one
  // cannot use up the job's time before the other starts.
  const [neonOk, vercelOk] = await Promise.all([
    deleteNeonBranches({
      neonConfigs,
      name: `${PREVIEW_BRANCH_PREFIX}${ref}`,
      fetchImpl: timedFetch,
      log,
      sleep,
    }),
    deleteVercelPreviews(
      {
        token: env.VERCEL_TOKEN,
        teamId: env.VERCEL_ORG_ID || VERCEL_TEAM_ID,
        fetchImpl: timedFetch,
      },
      { ref, log },
    ),
  ]);
  return neonOk && vercelOk;
}

if (isMainModule(import.meta.url)) {
  runPreviewTeardown({}).then(
    (ok) => {
      process.exitCode = ok ? 0 : 1;
    },
    (error) => {
      console.error(errorMessage(error));
      process.exitCode = 1;
    },
  );
}
