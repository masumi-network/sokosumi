// Run with Core's environment, including its database URL and Network layout:
// pnpm --filter core exec tsx --env-file=.env scripts/check-crossing-key-orphans.mts
import process from "node:process";
import { countCrossingKeyOrphans } from "../src/lib/db/crossing-key-orphans";
import prisma from "../src/lib/db/prisma";

try {
  const counts = await countCrossingKeyOrphans(prisma);
  for (const { network, key, count } of counts) {
    console.log(`${network}\t${key}\t${count}`);
  }
  if (counts.some(({ count }) => count > 0n)) process.exitCode = 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
