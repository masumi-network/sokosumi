// Run with Core's environment, including its database URL and Network layout:
// pnpm --filter core exec tsx --env-file=.env scripts/check-crossing-key-orphans.mts
// Exit code: 0 no orphan, 3 at least one orphan. Any other code means the
// check did not run: 2 from a failed query, 1 from Core's startup checks.
import process from "node:process";
import { countCrossingKeyOrphans } from "../src/lib/db/crossing-key-orphans";
import prisma from "../src/lib/db/prisma";

try {
  const counts = await countCrossingKeyOrphans(prisma);
  for (const { network, key, count } of counts) {
    console.log(`${network}\t${key}\t${count}`);
  }
  if (counts.some(({ count }) => count > 0n)) process.exitCode = 3;
} catch (error) {
  console.error(error);
  process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
