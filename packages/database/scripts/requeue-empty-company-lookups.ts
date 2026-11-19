/** Run with --apply only after the fixed Core is live. Reuse the same Core cutover timestamp on every run. */
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { config as loadEnv } from "dotenv";
import { createPrismaClient, PrismaRaw } from "../src/client.js";
import { checkMigrateDeployEnv } from "../src/helpers/migrate-deploy-preflight.js";

loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: { before: { type: "string" }, apply: { type: "boolean" } },
  });
  const before = new Date(values.before ?? "");
  if (
    !values.before?.endsWith("Z") ||
    !Number.isFinite(before.getTime()) ||
    before.getTime() > Date.now()
  ) {
    throw new Error(
      "Pass the Core cutover as a past UTC timestamp with --before.",
    );
  }

  const check = checkMigrateDeployEnv(process.env);
  if (!check.ok)
    throw new Error(check.messages.map(({ text }) => text).join("\n"));
  for (const message of check.messages) console.warn(message.text);
  const url =
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("Set DATABASE_URL_UNPOOLED or DATABASE_URL.");

  const prisma = createPrismaClient(url);
  const matches = PrismaRaw.sql`
    "enrichedAt" < (${before}::timestamptz AT TIME ZONE 'UTC')
    AND description IS NULL
    AND industry IS NULL
    AND size IS NULL
    AND headquarters IS NULL
  `;
  try {
    if (values.apply) {
      const count = await prisma.$executeRaw`
        UPDATE contact_company
        SET "enrichedAt" = NULL, "lookupFailures" = 0
        WHERE ${matches}
      `;
      console.log(`Company lookups requeued: ${count}`);
    } else {
      const [row] = await prisma.$queryRaw<[{ count: bigint }]>`
        SELECT count(*) AS count FROM contact_company WHERE ${matches}
      `;
      console.log(`Company lookups eligible to requeue: ${row.count}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
