/**
 * Vercel / CI migrate entrypoint for `@sokosumi/database`.
 *
 * On Vercel Preview: reset the Neon branch from its parent, then run
 * `prisma migrate deploy`. Elsewhere: migrate deploy only.
 *
 * Invoked via `pnpm prisma:migrate:deploy` (Core `vercel-build` after app build).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  planNeonPreviewBranchReset,
  resetNeonPreviewBranchFromParent,
} from "../src/helpers/neon-preview-branch-reset.js";

async function main(): Promise<void> {
  const plan = planNeonPreviewBranchReset({
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    NEON_API_KEY: process.env.NEON_API_KEY,
    NEON_PROJECT_ID: process.env.NEON_PROJECT_ID,
    NEON_BRANCH_ID: process.env.NEON_BRANCH_ID,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
  });

  if (plan.action === "error") {
    console.error(`[migrate-deploy] error: ${plan.message}`);
    process.exit(1);
  }

  if (plan.action === "reset") {
    console.log(
      "[migrate-deploy] Preview: resetting Neon branch from parent before migrate…",
    );
    const result = await resetNeonPreviewBranchFromParent(plan);
    if (result) {
      console.log(
        `[migrate-deploy] Reset branch ${result.branchName} (${result.branchId}) from parent ${result.parentBranchId}`,
      );
    }
  } else {
    console.log(`[migrate-deploy] ${plan.reason}`);
  }

  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const result = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: process.env,
    cwd: packageRoot,
  });

  if (result.error) {
    console.error("[migrate-deploy] failed to spawn prisma:", result.error);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

main().catch((error: unknown) => {
  console.error("[migrate-deploy] unexpected error:", error);
  process.exit(1);
});
