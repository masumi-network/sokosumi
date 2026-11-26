/**
 * Writes the SEO rank points of the results imported before the import wrote them.
 * Optional: the rank history reads a loaded result without points from its payload. Only the
 * positions of full audits imported before then, and of results older than the newest 200 of
 * a period, need this run to reach the history.
 *
 *   pnpm --filter @sokosumi/core seo:backfill-rank-points -- --dry-run
 *   pnpm --filter @sokosumi/core seo:backfill-rank-points
 */
import process from "node:process";
import prisma from "../src/lib/db/prisma";
import { backfillSeoRankPoints } from "../src/services/project-seo-rank-points-backfill";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.some((arg) => arg !== "--dry-run")) {
  console.error("Supported option: --dry-run");
  process.exit(1);
}
const dryRun = args.includes("--dry-run");
try {
  const { results, unreadable, points } = await backfillSeoRankPoints({
    dryRun,
  });
  console.log(
    `Results read: ${results}. Unreadable, left out: ${unreadable}. ` +
      (dryRun
        ? `Rank points missing: ${points}.`
        : `Rank points written: ${points}.`),
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
