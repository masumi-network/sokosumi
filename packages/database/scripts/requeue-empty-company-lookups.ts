/** Run with --apply only after the fixed Core is live. Reuse the same Core cutover timestamp on every run. */
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createPrismaClient } from "../src/client.js";
import { checkMigrateDeployEnv } from "../src/helpers/migrate-deploy-preflight.js";
import {
  parseRequeueEmptyCompanyLookupsArgs,
  requeueEmptyCompanyLookups,
} from "../src/helpers/requeue-empty-company-lookups.js";
import {
  configureSqlTables,
  sqlTableLayoutFromEnv,
} from "../src/sql-tables.js";

loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
// Raw SQL names the schemas the environment names, as Core does.
configureSqlTables(sqlTableLayoutFromEnv(process.env));

async function main() {
  const { before, apply } = parseRequeueEmptyCompanyLookupsArgs(
    process.argv.slice(2),
  );

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
    const count = await requeueEmptyCompanyLookups(prisma, { before, apply });
    console.log(
      apply
        ? `Company lookups requeued: ${count}`
        : `Company lookups eligible to requeue: ${count}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
