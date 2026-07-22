import "dotenv/config";

import { createPrismaClient } from "../src/client.js";
import { assertLocalDatabaseUrl } from "./seed/assert-local-database-url.js";
import { runSeed } from "./seed/run-seed.js";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  assertLocalDatabaseUrl(databaseUrl);

  const prisma = createPrismaClient(databaseUrl!);

  try {
    await runSeed(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
