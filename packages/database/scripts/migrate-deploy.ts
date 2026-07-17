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

import { checkMigrateDeployEnv } from "../src/helpers/migrate-deploy-preflight.js";
import {
  planNeonPreviewBranchReset,
  resetNeonPreviewBranchFromParent,
} from "./neon-preview-branch-reset.js";

async function main(): Promise<void> {
  // Fail closed before any destructive Neon reset when Preview is misconfigured.
  const preflight = checkMigrateDeployEnv({
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
  });
  for (const message of preflight.messages) {
    const write = message.level === "error" ? console.error : console.warn;
    write(`[migrate-deploy] ${message.level}: ${message.text}`);
  }
  if (!preflight.ok) {
    process.exit(1);
  }

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
      const ops =
        result.operationIds.length > 0
          ? `; operations=${result.operationIds.join(",")}`
          : "";
      console.log(
        `[migrate-deploy] Reset branch ${result.branchName} (${result.branchId}) from parent ${result.parentBranchId}${ops}`,
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

  if (result.signal) {
    console.error(
      `[migrate-deploy] prisma migrate deploy terminated by signal ${result.signal}`,
    );
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

main().catch((error: unknown) => {
  console.error("[migrate-deploy] unexpected error:", error);
  process.exit(1);
});
