import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * A shared Soko Bot has no owner: its `userId` is `null`. Read raw into a
 * Prisma `where`, that value either matches the wrong rows (`IS NULL`) or,
 * once someone writes `bot.userId ?? undefined`, silently removes the filter
 * and with it a privacy guard. Owner reads branch on `isPersonalSokoBot`
 * (`@/helpers/soko-bot-kind`) first, so the shared case is a branch the
 * caller has to write.
 *
 * The check scans every Core source file for a `where: { ... }` object whose
 * body reads `<something>Bot.userId` or `<something>bot.userId`. It is not
 * full coverage. It does not catch:
 * - a where returned by a helper (`where: helper(bot.userId)`);
 * - a where or part of one built first (`const where = { ownerId: bot.userId }`);
 * - the owner under another variable name (`const ownerId = bot.userId`,
 *   `owner.userId`, `row.userId`);
 * - raw SQL.
 * Those still need review.
 *
 * KNOWN lists reads a later layer of the shared bots stack still has to fix.
 * The count per file must match exactly: a new read fails, and so does a
 * fixed one until its entry is removed here. The last ones (notices, rhythms,
 * board digests) moved to `turnDestinationRoom`, `resolveNoticeRoom` and
 * `rhythmTaskScope`, so none is left.
 */
const KNOWN: Record<string, number> = {};

const RAW_OWNER_READ = /\b[\w$]*[bB]ot\??\.userId\b/g;
const WHERE_OPEN = /\bwhere\s*:\s*\{/g;

/** Offsets of raw bot owner reads inside `where: { ... }` objects. */
function rawSokoBotOwnerWhereReads(source: string): number[] {
  const offsets = new Set<number>();
  for (const open of source.matchAll(WHERE_OPEN)) {
    const start = (open.index ?? 0) + open[0].length - 1;
    let depth = 0;
    let end = start;
    for (; end < source.length; end++) {
      if (source[end] === "{") depth++;
      else if (source[end] === "}" && --depth === 0) break;
    }
    for (const read of source.slice(start, end + 1).matchAll(RAW_OWNER_READ)) {
      offsets.add(start + (read.index ?? 0));
    }
  }
  return [...offsets].sort((a, b) => a - b);
}

function coreSourceReads(): Map<string, string[]> {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const found = new Map<string, string[]>();
  for (const entry of globSync("**/*.ts", { cwd: root })) {
    if (/\.(test|spec)\.ts$/.test(entry) || entry.includes("test-fixtures"))
      continue;
    const source = readFileSync(path.join(root, entry), "utf8");
    const reads = rawSokoBotOwnerWhereReads(source).map((offset) => {
      const line = source.slice(0, offset).split("\n").length;
      return `${entry}:${line}`;
    });
    if (reads.length > 0) found.set(entry, reads);
  }
  return found;
}

describe("rawSokoBotOwnerWhereReads", () => {
  it("finds a raw owner read in a where, nested or not", () => {
    expect(
      rawSokoBotOwnerWhereReads(
        "prisma.task.findMany({ where: { ownerId: bot.userId } })",
      ),
    ).toHaveLength(1);
    expect(
      rawSokoBotOwnerWhereReads(
        "x({ where: { task: { NOT: { ownerId: turn.sokoBot.userId } } } })",
      ),
    ).toHaveLength(1);
    expect(
      rawSokoBotOwnerWhereReads(
        "x({ where: { userMembers: { some: { userId: bot?.userId } } } })",
      ),
    ).toHaveLength(1);
  });

  it("ignores reads outside a where and the helpers' output", () => {
    expect(
      rawSokoBotOwnerWhereReads(
        "const label = bot.userId; x({ data: { userId: bot.userId } });",
      ),
    ).toEqual([]);
    expect(
      rawSokoBotOwnerWhereReads(
        "x({ where: { ownerId: ownerUserId, userId: turn.userId } })",
      ),
    ).toEqual([]);
  });
});

describe("Soko Bot owner reads in Prisma wheres", () => {
  it("go through the owner helpers, apart from the listed later-layer reads", () => {
    const found = coreSourceReads();
    const counts = Object.fromEntries(
      [...found].map(([file, reads]) => [file, reads.length]),
    );
    expect(
      counts,
      `Raw Soko Bot userId in a where: ${[...found.values()].flat().join(", ")}`,
    ).toEqual(KNOWN);
  });
});
