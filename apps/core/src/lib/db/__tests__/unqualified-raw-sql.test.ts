import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../../../..", import.meta.url));

// Raw SQL names every table with its schema, through `sharedTable` and
// `netTable` (`@sokosumi/database/sql-tables`): the tables leave `public`, and
// the clients share one pool, so no statement may lean on the search path.
//
// The rule is plain on purpose. A finding is an uppercase SQL keyword that
// takes a table, followed by the SQL name of one of our tables
// (`network-tables.json`), bare or in double quotes, with no schema before it.
// What it cannot see:
// - SQL with lowercase keywords (`from project_image_job`);
// - a table after a comma (`FROM a, b`, `TRUNCATE a, b`) or after `ON`
//   (`CREATE INDEX … ON "x"`);
// - SQL built from string pieces, a table name held in a variable, and
//   anything passed to `$queryRawUnsafe` that is not literal text;
// - a schema written out by hand (`public."user"`): it counts as qualified;
// - a common table expression named like a table is a false finding.
const KEYWORDS = "FROM|JOIN|INTO|UPDATE|USING|TABLE|TRUNCATE|ONLY|REFERENCES";

/** Files and folders the check leaves out, each with its reason. */
const EXCLUDED: Record<string, string> = {
  "packages/database/prisma/migrations/":
    "applied migrations are fixed text; ticket 19 rewrites the trigger and function bodies",
  "packages/database/scripts/split-network-layout.sh":
    "moves the tables out of public by name, for the test layout only",
  "packages/database/prisma/tests/task-schedule-cutover-report.sql":
    "a psql report for one finished cutover; it cannot read the configuration",
  "packages/database/src/helpers/credit-bucket-owner-xor.test.ts":
    "quotes migration text",
  "packages/database/src/repositories/curated-vocabulary-migration.test.ts":
    "quotes migration text",
  "packages/database/src/types/__tests__/calendar-collaboration-migration.test.ts":
    "quotes migration text",
  "packages/database/src/types/__tests__/soko-bot-control-plane-migration.test.ts":
    "quotes migration text",
  "packages/database/src/types/__tests__/x402-migration-convergence.test.ts":
    "quotes migration text",
  "packages/database/src/types/__tests__/newsletter-sending-domain-migration.test.ts":
    "runs a migration on temporary tables, which have no schema to name",
  "packages/database/src/helpers/remap-pa-shadow-coworkers.db.test.ts":
    "replays the migrations into a database of its own",
  "apps/core/src/lib/db/__tests__/unqualified-raw-sql.test.ts":
    "this file's examples",
};

/**
 * Where a finding fails the build. Everywhere else it is only reported.
 * Ticket 17 adds "core", "scripts" and "tests" once their SQL is converted.
 */
const ENFORCED: readonly Group[] = ["database"];

type Group = "database" | "core" | "scripts" | "tests";

interface Finding {
  file: string;
  line: number;
  text: string;
}

const tables = JSON.parse(
  readFileSync(
    join(ROOT, "packages/database/prisma/network-tables.json"),
    "utf8",
  ),
) as {
  network: Record<string, string>;
  networkJoinTables: string[];
  shared: Record<string, string>;
};

// Longest first, so `task_file` is not read as `task`.
const tableNames = [
  ...Object.values(tables.network),
  ...tables.networkJoinTables,
  ...Object.values(tables.shared),
].sort((a, b) => b.length - a.length);

const UNQUALIFIED = new RegExp(
  `\\b(?:${KEYWORDS})\\s+(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?("?)(?:${tableNames.join("|")})\\1(?![\\w".])`,
  "g",
);

function unqualifiedTables(file: string, source: string): Finding[] {
  return [...source.matchAll(UNQUALIFIED)].map((match) => ({
    file,
    line: source.slice(0, match.index).split("\n").length,
    text: match[0].replace(/\s+/g, " "),
  }));
}

function groupOf(file: string): Group {
  if (file.startsWith("packages/database/")) return "database";
  if (/\.test\.|\/__tests__\/|\/test\/|\/e2e\//.test(file)) return "tests";
  return file.startsWith("apps/core/src/") ? "core" : "scripts";
}

/** Every source file of the repository, tracked or new, minus `EXCLUDED`. */
function sourceFiles(): string[] {
  return execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...["ts", "tsx", "mts", "cts", "js", "mjs", "cjs", "sql", "sh"].map(
        (extension) => `*.${extension}`,
      ),
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\n")
    .filter(
      (file) =>
        file !== "" &&
        !Object.keys(EXCLUDED).some((excluded) => file.startsWith(excluded)),
    );
}

function repositoryFindings(): Finding[] {
  return sourceFiles().flatMap((file) => {
    try {
      return unqualifiedTables(file, readFileSync(join(ROOT, file), "utf8"));
    } catch {
      // Deleted in the working tree but still in the index.
      return [];
    }
  });
}

describe("unqualified table names in raw SQL", () => {
  it.each([
    ['SELECT id FROM "Job" WHERE id = $1', 'FROM "Job"'],
    ["LEFT JOIN credit_consumption cc ON cc.id = 1", "JOIN credit_consumption"],
    ['INSERT INTO "user" (id) VALUES ($1)', 'INTO "user"'],
    ["UPDATE task SET title = $1", "UPDATE task"],
    ["DELETE FROM task_file WHERE id = $1", "FROM task_file"],
    ['SELECT 1\n  FROM\n    "jobEvent"', 'FROM "jobEvent"'],
    ['DROP TABLE IF EXISTS "Job"', 'TABLE IF EXISTS "Job"'],
    ["TRUNCATE soko_bot CASCADE", "TRUNCATE soko_bot"],
  ])("finds %s", (source, text) => {
    expect(unqualifiedTables("x.ts", source)).toEqual([
      { file: "x.ts", line: expect.any(Number), text },
    ]);
  });

  it.each([
    'SELECT id FROM ${netTable("mainnet", "Job")} j',
    'JOIN ${sharedTable("user")} u ON u.id = j."userId"',
    'SELECT id FROM "mainnet"."Job"',
    'SELECT id FROM shared."user"',
    "SELECT id FROM bucket_avail",
    'SELECT id FROM "Jobs"',
    "SELECT task.id FROM ${tasks} task",
    "// reads the title from task and project",
  ])("passes %s", (source) => {
    expect(unqualifiedTables("x.ts", source)).toEqual([]);
  });

  it("reports the line of the table's keyword", () => {
    expect(
      unqualifiedTables(
        "x.ts",
        'const a = 1;\nconst b = `\n  SELECT 1 FROM "Job"`;',
      ),
    ).toEqual([{ file: "x.ts", line: 3, text: 'FROM "Job"' }]);
  });

  it("names only excluded paths that exist", () => {
    expect(
      Object.keys(EXCLUDED).filter((path) => !existsSync(join(ROOT, path))),
    ).toEqual([]);
  });

  it("is found nowhere it is enforced, and reported elsewhere", () => {
    const found = repositoryFindings();
    const counts = (["database", "core", "scripts", "tests"] as const).map(
      (group) => {
        const inGroup = found.filter(({ file }) => groupOf(file) === group);
        const files = new Set(inGroup.map(({ file }) => file)).size;
        return `${group} ${inGroup.length} in ${files} files`;
      },
    );
    // RAW_SQL_LIST=1 prints every finding as file:line.
    const list = process.env.RAW_SQL_LIST
      ? found.map(({ file, line, text }) => `\n${file}:${line}: ${text}`)
      : [];
    console.log(
      `Unqualified table names in raw SQL: ${counts.join(", ")}.${list.join("")}`,
    );
    expect(
      found.filter(({ file }) => ENFORCED.includes(groupOf(file))),
      "Name the table through sharedTable or netTable (@sokosumi/database/sql-tables).",
    ).toEqual([]);
  });
});
