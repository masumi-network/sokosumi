/** Run after the Core deployment that excludes Task presets from Files classification is live. */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createPrismaClient } from "../src/client.js";
import { backfillTaskWorkTypePresets } from "../src/helpers/backfill-task-work-type-presets.js";
import { checkMigrateDeployEnv } from "../src/helpers/migrate-deploy-preflight.js";

loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.some((arg) => arg !== "--dry-run")) {
    throw new Error("Supported option: --dry-run");
  }
  const dryRun = args.includes("--dry-run");
  const check = checkMigrateDeployEnv(process.env);
  if (!check.ok)
    throw new Error(check.messages.map(({ text }) => text).join("\n"));
  for (const message of check.messages) console.warn(message.text);
  const url =
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("Set DATABASE_URL_UNPOOLED or DATABASE_URL.");
  const prisma = createPrismaClient(url);
  try {
    const count = await backfillTaskWorkTypePresets(prisma, { dryRun });
    console.log(
      dryRun
        ? `Missing Task work-type presets: ${count}`
        : `Inserted Task work-type presets: ${count}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
