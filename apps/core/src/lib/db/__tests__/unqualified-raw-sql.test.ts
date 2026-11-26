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
// The rule is plain on purpose, and it only reports. A finding is an uppercase
// SQL keyword that takes a table, followed by the SQL name of one of our
// tables (`network-tables.json`) with no schema before it: in double quotes in
// its exact spelling, or, for a table whose name is all lowercase, bare in any
// case (PostgreSQL folds a bare name, so a bare `Lock` is not `"Lock"`).
// `CREATE TEMP TABLE <name>` is no finding: a temporary table has no schema
// to name.
// What it cannot see:
// - SQL with lowercase keywords (`from project_image_job`);
// - a table after a comma (`FROM a, b`, `TRUNCATE a, b`), after `ON`
//   (`CREATE INDEX … ON "x"`) or after `LOCK`, `ANALYZE`, `VACUUM`, `COPY`;
// - a table after a comment between keyword and name;
// - a table in escaped quotes inside a plain string literal
//   (`"SELECT key FROM \"Lock\""`): the source has `\"`, not `"`;
// - SQL built from string pieces, a table name held in a variable, and
//   anything passed to `$queryRawUnsafe` that is not literal text;
// - an enum cast without its schema (`::"TaskStatus"`; use `sharedType` or
//   `netType`), a sequence, or any other object that is not a table;
// - a schema written out by hand (`public."user"`): it counts as qualified;
// - a file whose path Git prints quoted (unusual characters).
// False findings: a common table expression named like a table, a statement
// on a temporary table after its `CREATE`, and prose in a comment or string
// that happens to read like SQL. These are why it does not fail the build.
// What does fail: the prepare step of CI's job `Test Core PostgreSQL split
// layout` (`scripts/prepare-raw-sql.ts`), on a bare table or type name in a
// raw SQL statement under its `SOURCE_PATHS` that it can resolve and prepare.
// It skips commands PostgreSQL cannot prepare (for example `LOCK TABLE`) and
// statements with a fragment it cannot resolve: a bare name there fails only
// in a test that runs that SQL on the split layout. That job is not a
// required check today, so it turns red and does not block a merge.
const KEYWORDS = "FROM|JOIN|INTO|UPDATE|USING|TABLE|TRUNCATE|ONLY|REFERENCES";

/**
 * Files and folders the check leaves out, each with its reason. An entry that
 * ends in `/` is a folder; any other matches that one file.
 */
const EXCLUDED: Record<string, string> = {
  "packages/database/prisma/migrations/":
    "applied migrations are fixed text; ticket 19 rewrites the trigger and function bodies",
  "packages/database/scripts/split-network-layout.sh":
    "moves the tables out of public by name, for the test layout only",
  "packages/database/prisma/tests/task-schedule-cutover-report.sql":
    "a psql report for one finished cutover; it cannot read the configuration",
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
 * Where a finding fails the build: nowhere yet, the check only reports.
 * Ticket 17 lists the groups here once their SQL is converted and the false
 * findings above are dealt with. Turbo replays a cached pass of Core's tests
 * when only files outside Core and its dependencies changed (root
 * `scripts/`), so "scripts" also needs those paths in the inputs of Core's
 * test task.
 */
const ENFORCED: readonly Group[] = [];

/** Where raw SQL can live. Web, CMO and the CLI have no database access. */
const SCANNED = ["apps/core", "packages/database", "scripts"];

/** "scripts" is every file outside the three other groups. */
const GROUPS = ["database", "core", "scripts", "tests"] as const;
type Group = (typeof GROUPS)[number];

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

const tableNames = [
  ...Object.values(tables.network),
  ...tables.networkJoinTables,
  ...Object.values(tables.shared),
];
// PostgreSQL folds a bare name to lowercase, so a bare name in any case can
// only be a table whose name is all lowercase (`lock` is never `"Lock"`).
const exact = tableNames.join("|");
const anyCase = tableNames
  .filter((name) => name === name.toLowerCase())
  .join("|");

const UNQUALIFIED = new RegExp(
  `(?<!CREATE\\s+(?:TEMP|TEMPORARY)\\s+)\\b(?:${KEYWORDS})\\s+(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?(?:"(?:${exact})"|(?i:${anyCase}))(?![\\w".])`,
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

/** Every source file where SQL can live, tracked or new, minus `EXCLUDED`. */
function sourceFiles(): string[] {
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...SCANNED.flatMap((folder) =>
        ["ts", "tsx", "mts", "cts", "js", "mjs", "cjs", "sql", "sh"].map(
          (extension) => `${folder}/*.${extension}`,
        ),
      ),
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ).split("\n");
  return withoutExcluded(files);
}

function withoutExcluded(files: string[]): string[] {
  return files.filter(
    (file) =>
      file !== "" &&
      !Object.keys(EXCLUDED).some((excluded) =>
        excluded.endsWith("/") ? file.startsWith(excluded) : file === excluded,
      ),
  );
}

/** `find` over every scanned file that still exists. */
function repositoryFindings(
  find: (file: string, source: string) => Finding[],
): Finding[] {
  return sourceFiles().flatMap((file) =>
    // A file deleted in the working tree is still in the index.
    existsSync(join(ROOT, file))
      ? find(file, readFileSync(join(ROOT, file), "utf8"))
      : [],
  );
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
    ["SELECT id FROM WORKSPACE", "FROM WORKSPACE"],
    ["UPDATE Credit_Bucket SET amount = 0", "UPDATE Credit_Bucket"],
    ["CREATE TABLE workspace (id uuid)", "TABLE workspace"],
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
    'SELECT id FROM "WORKSPACE"',
    "SELECT 1 FROM x FOR UPDATE lock",
    "SELECT key FROM Lock",
    "CREATE TEMP TABLE workspace (id uuid PRIMARY KEY) ON COMMIT DROP",
    "CREATE TEMPORARY TABLE\n  workspace_label (LIKE x INCLUDING ALL)",
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

  it("leaves out an excluded file, not every path that starts like it", () => {
    const excluded =
      "packages/database/src/repositories/curated-vocabulary-migration.test.ts";
    const included = `${excluded}.ts`;
    expect(withoutExcluded([excluded, included])).toEqual([included]);

    const files = sourceFiles();
    expect(files.some((file) => file.includes("/prisma/migrations/"))).toBe(
      false,
    );
    expect(
      files.filter(
        (file) => !SCANNED.some((folder) => file.startsWith(folder)),
      ),
    ).toEqual([]);
  });

  it("reports unqualified table names and fails only where enforced", () => {
    const found = repositoryFindings(unqualifiedTables);
    const counts = GROUPS.map((group) => {
      const inGroup = found.filter(({ file }) => groupOf(file) === group);
      const files = new Set(inGroup.map(({ file }) => file)).size;
      return `${group} ${inGroup.length} in ${files} files`;
    });
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
