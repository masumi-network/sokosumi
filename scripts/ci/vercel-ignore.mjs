#!/usr/bin/env node
/**
 * Vercel Ignored Build Step for web, core, cmo, and cmo-website: the `ignoreCommand` in
 * each app's vercel.json. Exit 0 skips the build; any other code builds.
 *
 *   node ../../scripts/ci/vercel-ignore.mjs <turbo package>
 *
 * This replaces the project setting "Skip deployments when there are no
 * changes to the root directory or its dependencies". That setting runs
 * before `git.deploymentEnabled`, so it added a Skipped row per unaffected
 * project to the Vercel comment of every PR. Branch pushes create no
 * deployment, so they never reach this step.
 */
import { spawnSync } from "node:child_process";

/**
 * The SHA to compare against, or null when the build must run. Only a
 * production deployment of a new commit may skip: `/deploy` previews always
 * build, and a redeploy of the last deployed commit has no diff to read.
 */
export function ignoreBase(env = process.env) {
  const base = env.VERCEL_GIT_PREVIOUS_SHA;
  if (
    env.VERCEL_ENV !== "production" ||
    !base ||
    base === env.VERCEL_GIT_COMMIT_SHA
  ) {
    return null;
  }
  return base;
}

// The old Preprod's two Vercel projects (web, core). They are frozen until
// the owner deletes them: no push and no redeploy may build there. The
// dashboard's Ignored Build Step cannot do this, because `ignoreCommand` in
// vercel.json overrides it.
const FROZEN_PROJECT_IDS = new Set([
  "prj_CSgdc8zCRyR5ZT1LH8VkDJBJTtff",
  "prj_DsK6SqWjSU47g7O3unja5h4jtxMk",
]);

/**
 * True for a build of the frozen old Preprod, by project id, or by the
 * project's own `NETWORK` variable in case the id is not passed to this step.
 */
export function isFrozenProject(env = process.env) {
  return (
    FROZEN_PROJECT_IDS.has(env.VERCEL_PROJECT_ID) ||
    env.NETWORK?.toLowerCase() === "preprod"
  );
}

if (import.meta.main) {
  if (isFrozenProject()) {
    console.log("The old Preprod is frozen: skipping this build.");
    process.exit(0);
  }
  const base = ignoreBase();
  const turboPackage = process.argv[2];
  if (!base || !turboPackage) {
    process.exit(1);
  }
  // turbo exits 0 when the package and its workspace dependencies are
  // unchanged since `base`, 1 when they changed, and 2 on an error.
  // ponytail: Vercel clones ten commits deep. An older `base` makes turbo
  // count every package as changed, so an app builds at least every tenth
  // push. Deepen the clone here if that costs too many builds.
  const result = spawnSync(
    "turbo",
    [
      "query",
      "affected",
      `--base=${base}`,
      "--packages",
      turboPackage,
      "--exit-code",
    ],
    { stdio: "inherit" },
  );
  process.exit(result.status === 0 ? 0 : 1);
}
