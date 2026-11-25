import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { $Enums } from "@sokosumi/database";
import ts from "@typescript/typescript6";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../../../..", import.meta.url));

// Raw SQL names every table with its schema, through `sharedTable` and
// `netTable` (`@sokosumi/database/sql-tables`): the tables leave `public`, and
// the clients share one pool, so no statement may lean on the search path.
//
// Code files are parsed (TypeScript's parser), so comments are never read and
// only string and template literals are. A finding is a SQL keyword that takes
// a table, followed by the SQL name of one of our tables
// (`network-tables.json`) with no schema before it: in double quotes in its
// exact spelling, or, for a table whose name is all lowercase, bare in any
// case (PostgreSQL folds a bare name, so a bare `Lock` is not `"Lock"`).
// Keywords count in any case inside a SQL literal (a template tagged
// `$queryRaw`, `$executeRaw` or `sql`, or text passed to `$queryRawUnsafe`,
// `$executeRawUnsafe`, `$queryRaw(…)`, `Prisma.raw` or a `pg` `query`), and
// only in uppercase in any other literal, where lowercase is prose.
// Not a finding: `-- …` and `/* … */` inside a literal, a common table
// expression's name inside its statement, and a temporary table's name after
// its `CREATE TEMP TABLE` in the same file (a temporary table has no schema).
// Other files (`.sql`, `.sh`) are read whole, uppercase keywords only.
// What it cannot see:
// - a table after a comma (`FROM a, b`, `TRUNCATE a, b`);
// - lowercase SQL in a literal that is not passed straight to one of the
//   calls above (`const q = "select … from task"; client.query(q)`);
// - SQL built from string pieces where the keyword and the name are in
//   different literals, a table name held in a variable;
// - an enum cast without its schema (`::"TaskStatus"`; use `sharedType` or
//   `netType`), a sequence, or any other object that is not a table;
// - a schema written out by hand (`public."user"`): it counts as qualified.
const KEYWORDS =
  "FROM|JOIN|INTO|UPDATE|USING|TABLE|TRUNCATE|ONLY|REFERENCES|LOCK|ANALYZE|VACUUM|COPY|ON";

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
 * Path prefixes where a finding fails the build. A path joins once its count
 * is 0; slice B of ticket 17 adds Core's production code, slice C the tests
 * and the scripts. Core's `test:ci` task lists the root `scripts/` among its
 * Turbo inputs, so a change there runs this check again (`turbo.json`).
 */
const ENFORCED: readonly string[] = ["packages/database/"];

const HOW_TO_FIX =
  "Name the table through sharedTable(table) or netTable(network, table) from @sokosumi/database/sql-tables, as apps/core/AGENTS.md (Raw SQL) says.";

/** Where raw SQL can live. Web, CMO and the CLI have no database access. */
const SCANNED = ["apps/core", "packages/database", "scripts"];

/** "scripts" is every file outside the three other groups. */
const GROUPS = ["database", "core", "scripts", "tests"] as const;
type Group = (typeof GROUPS)[number];

const CODE = /\.[cm]?[jt]sx?$/;

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
  networkEnums: string[];
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

const exactNames = new Set(tableNames);
// Matched in any case; `isMention` then holds the case rules. Not with inline
// `(?i:…)` groups: in Core's unit run some of their case-insensitive matches
// failed after other files had run in the same worker.
const MENTION_HEAD = `\\b(${KEYWORDS})\\s+(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?("(?:${exact})"|(?:${anyCase}))`;
const MENTION = new RegExp(`${MENTION_HEAD}(?![\\w".])`, "gi");
// A file without this cannot hold a finding. Without the lookahead, which in a
// file's raw text sees the quote that ends a literal. Not global: `test` on a
// global expression moves where the next search starts.
const MAYBE = new RegExp(MENTION_HEAD, "i");

/** A quoted name in its exact spelling; outside SQL, an uppercase keyword. */
function isMention([, keyword, name]: RegExpMatchArray, sql: boolean): boolean {
  return (
    (sql || keyword === keyword.toUpperCase()) &&
    (!name.startsWith('"') || exactNames.has(name.slice(1, -1)))
  );
}
const CTE =
  /(?:\bWITH\s+(?:RECURSIVE\s+)?|,\s*)"?(\w+)"?\s*(?:\([^)]*\))?\s+AS\s+(?:NOT\s+)?(?:MATERIALIZED\s+)?\(/gi;
const TEMP_TABLE =
  /\bCREATE\s+(?:(?:LOCAL|GLOBAL)\s+)?(?:TEMP|TEMPORARY)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi;
// Replaced by spaces, so positions and lines stay where they were.
const SQL_COMMENT = /--[^\n]*|\/\*[\s\S]*?\*\//g;

const SQL_TAGS = new Set(["$queryRaw", "$executeRaw", "sql"]);
const SQL_CALLS = new Set([
  "$queryRawUnsafe",
  "$executeRawUnsafe",
  "$queryRaw",
  "$executeRaw",
  "raw",
  "query",
]);

/** One literal: its text, where it starts, and whether it is SQL for sure. */
interface Part {
  text: string;
  start: number;
}
interface Literal {
  parts: Part[];
  sql: boolean;
}

function nameOf(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

/** A literal is SQL when it reaches a SQL tag or call through `+`, `?:` or `${}`. */
function isSql(node: ts.Node): boolean {
  let child: ts.Node = node;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isTaggedTemplateExpression(parent)) {
      return SQL_TAGS.has(nameOf(parent.tag) ?? "");
    }
    if (ts.isCallExpression(parent)) {
      return (
        parent.arguments.includes(child as ts.Expression) &&
        SQL_CALLS.has(nameOf(parent.expression) ?? "")
      );
    }
    if (
      !(
        ts.isParenthesizedExpression(parent) ||
        ts.isConditionalExpression(parent) ||
        ts.isTemplateSpan(parent) ||
        ts.isTemplateExpression(parent) ||
        ts.isAsExpression(parent) ||
        (ts.isBinaryExpression(parent) &&
          parent.operatorToken.kind === ts.SyntaxKind.PlusToken)
      )
    ) {
      return false;
    }
    child = parent;
  }
  return false;
}

function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** The literals of a code file, in source order; comments are not literals. */
function literals(file: string, source: string): Literal[] {
  const sourceFile = parse(file, source);
  const found: Literal[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push({
        parts: [{ text: node.text, start: node.getStart(sourceFile) + 1 }],
        sql: isSql(node),
      });
    } else if (ts.isTemplateExpression(node)) {
      found.push({
        parts: [
          node.head,
          ...node.templateSpans.map((span) => span.literal),
        ].map((part) => ({
          text: part.text,
          start: part.getStart(sourceFile) + 1,
        })),
        sql: isSql(node),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function lineAt(source: string, position: number): number {
  return source.slice(0, position).split("\n").length;
}

function unqualifiedTables(file: string, source: string): Finding[] {
  // Most files name no table after any keyword: no need to parse them.
  if (!MAYBE.test(source)) return [];
  const statements: Literal[] = CODE.test(file)
    ? literals(file, source)
    : [{ parts: [{ text: source, start: 0 }], sql: false }];
  // Not in a shell script, where `--` starts a flag.
  const stripComments = !file.endsWith(".sh");
  const cleaned = statements.map(({ parts, sql }) => ({
    sql,
    parts: parts.map(({ text, start }) => ({
      start,
      text: stripComments
        ? text.replace(SQL_COMMENT, (comment) => comment.replace(/[^\n]/g, " "))
        : text,
    })),
  }));
  // A temporary table exists from its `CREATE` to the end of the file.
  const temporary = cleaned.flatMap(({ parts }) =>
    parts.flatMap(({ text, start }) =>
      [...text.matchAll(TEMP_TABLE)].map((match) => ({
        name: match[1].toLowerCase(),
        from: start + match.index,
      })),
    ),
  );
  return cleaned.flatMap(({ parts, sql }) => {
    const statement = parts.map(({ text }) => text).join(" ");
    const commonTables = new Set(
      [...statement.matchAll(CTE)].map((match) => match[1].toLowerCase()),
    );
    return parts.flatMap(({ text, start }) =>
      [...text.matchAll(MENTION)]
        .filter((match) => {
          if (!isMention(match, sql)) return false;
          const name = match[2].replaceAll('"', "").toLowerCase();
          const at = start + match.index;
          return (
            !commonTables.has(name) &&
            !temporary.some((table) => table.name === name && table.from <= at)
          );
        })
        .map((match) => ({
          file,
          // A string literal's `\n` escapes count as lines; templates hold
          // their newlines as they are.
          line:
            lineAt(source, start) +
            text.slice(0, match.index).split("\n").length -
            1,
          text: match[0].replace(/\s+/g, " "),
        })),
    );
  });
}

const NAMES = {
  table: {
    shared: new Set(Object.values(tables.shared)),
    network: new Set([
      ...Object.values(tables.network),
      ...tables.networkJoinTables,
    ]),
  },
  type: {
    shared: new Set(
      Object.keys($Enums).filter((name) => !tables.networkEnums.includes(name)),
    ),
    network: new Set(tables.networkEnums),
  },
};

/** Which argument of each helper is the name, and of which side. */
const HELPERS = new Map<
  string,
  { argument: number; kind: "table" | "type"; side: "shared" | "network" }
>([
  ["sharedTable", { argument: 0, kind: "table", side: "shared" }],
  ["netTable", { argument: 1, kind: "table", side: "network" }],
  ["sharedType", { argument: 0, kind: "type", side: "shared" }],
  ["netType", { argument: 1, kind: "type", side: "network" }],
]);

/** Files whose calls of the helpers are not checked, each with its reason. */
const NAMES_NOT_CHECKED: Record<string, string> = {
  "packages/database/src/sql-tables.ts":
    "defines the helpers and passes their arguments on",
  "packages/database/src/sql-tables.test.ts":
    "passes wrong names on purpose, to test the refusals",
  "packages/database/src/helpers/job-sync.postgres.test.ts":
    "creates every Network enum type from the list",
};

/**
 * Every call of a helper whose name argument is not a literal name of the
 * helper's side. The helpers refuse such a name too, but only when the
 * statement runs.
 */
function wrongHelperNames(file: string, source: string): Finding[] {
  if (!/\b(?:shared|net)T(?:able|ype)\b/.test(source)) return [];
  const sourceFile = parse(file, source);
  const found: Finding[] = [];
  const visit = (node: ts.Node) => {
    const helper = ts.isCallExpression(node)
      ? HELPERS.get(nameOf(node.expression) ?? "")
      : undefined;
    if (helper && ts.isCallExpression(node)) {
      const { argument, kind, side } = helper;
      const name = node.arguments[argument];
      const other = side === "shared" ? "network" : "shared";
      const problem =
        !name ||
        !(ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))
          ? "the name is not a literal"
          : NAMES[kind][other].has(name.text)
            ? `${name.text} is a ${other === "network" ? "Network" : "shared"} ${kind}`
            : NAMES[kind][side].has(name.text)
              ? undefined
              : `unknown ${kind}: ${name.text}`;
      if (problem) {
        found.push({
          file,
          line: lineAt(source, node.getStart(sourceFile)),
          text: `${nameOf(node.expression)}: ${problem}`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function groupOf(file: string): Group {
  if (file.startsWith("packages/database/")) return "database";
  if (/\.test\.|\/__tests__\/|\/test\/|\/e2e\//.test(file)) return "tests";
  return file.startsWith("apps/core/src/") ? "core" : "scripts";
}

function isEnforced(file: string): boolean {
  return ENFORCED.some((prefix) => file.startsWith(prefix));
}

/** Tracked and new files under `folders` with one of `extensions`. */
function gitFiles(folders: string[], extensions: string[]): string[] {
  return execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...folders.flatMap((folder) =>
        extensions.map((extension) => `${folder}*.${extension}`),
      ),
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter((file) => file !== "");
}

const CODE_EXTENSIONS = ["ts", "tsx", "mts", "cts", "js", "mjs", "cjs"];

/** Every source file where SQL can live, minus `EXCLUDED`. */
function sourceFiles(): string[] {
  return gitFiles(
    SCANNED.map((folder) => `${folder}/`),
    [...CODE_EXTENSIONS, "sql", "sh"],
  ).filter(
    (file) =>
      !Object.keys(EXCLUDED).some((excluded) =>
        excluded.endsWith("/") ? file.startsWith(excluded) : file === excluded,
      ),
  );
}

/** `find` over every listed file that still exists. */
function repositoryFindings(
  files: string[],
  find: (file: string, source: string) => Finding[],
): Finding[] {
  return files.flatMap((file) =>
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
    ['LOCK "Job" IN SHARE MODE', 'LOCK "Job"'],
    ["ANALYZE task", "ANALYZE task"],
    ["VACUUM task", "VACUUM task"],
    ["COPY task FROM STDIN", "COPY task"],
    ['CREATE INDEX x ON "Job" (id)', 'ON "Job"'],
  ])("finds %s", (sql, text) => {
    expect(unqualifiedTables("x.sql", sql)).toEqual([
      { file: "x.sql", line: expect.any(Number), text },
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
    'SELECT id FROM "WORKSPACE"',
    "SELECT 1 FROM x FOR UPDATE lock",
    "SELECT key FROM Lock",
    'JOIN x j ON "Job".id = j.id',
    "CREATE TEMP TABLE workspace (id uuid PRIMARY KEY) ON COMMIT DROP",
    "CREATE TEMPORARY TABLE\n  workspace_label (LIKE x INCLUDING ALL)",
  ])("passes %s", (sql) => {
    expect(unqualifiedTables("x.sql", sql)).toEqual([]);
  });

  it.each([
    ["tx.$queryRaw`select id from task`", "from task"],
    ["tx.$executeRaw<number>`update task set x = 1`", "update task"],
    ["tx.$executeRaw`drop table if exists task`", "table if exists task"],
    ["Prisma.sql`join project p on p.id = t.id`", "join project"],
    ['tx.$queryRawUnsafe("delete from task_file")', "from task_file"],
    ['tx.$queryRawUnsafe("select 1 from task where id = " + id)', "from task"],
    ["client.query(cond ? 'select * from task' : 'select 1')", "from task"],
    ["const q = `SELECT 1 FROM task`;", "FROM task"],
    ['sql`SELECT 1 FROM ${a} JOIN "Job" j`', 'JOIN "Job"'],
  ])("finds in code: %s", (code, text) => {
    expect(unqualifiedTables("x.ts", code)).toEqual([
      { file: "x.ts", line: 1, text },
    ]);
  });

  it.each([
    "// UPDATE task SET title = $1",
    "/* SELECT 1 FROM task */",
    'throw new Error("the title comes from project")',
    "const from = task;",
    "tx.$queryRaw`SELECT 1 -- FROM task\n`",
    "tx.$queryRaw`SELECT 1 /* JOIN task */`",
    "tx.$queryRaw`WITH task AS (SELECT 1) SELECT * FROM task`",
    "tx.$queryRaw`WITH task (id) AS (SELECT 1) SELECT * FROM task`",
    "tx.$executeRaw`CREATE LOCAL TEMP TABLE task (id int)`;\ntx.$executeRaw`INSERT INTO task VALUES (1)`;",
    'sql`WITH a AS (SELECT 1), "project" AS (SELECT 2) SELECT * FROM ${x} JOIN project ON true`',
    "tx.$executeRawUnsafe(`CREATE TEMP TABLE task (id int)`);\ntx.$executeRawUnsafe(`INSERT INTO task VALUES (1)`);",
  ])("passes in code: %s", (code) => {
    expect(unqualifiedTables("x.ts", code)).toEqual([]);
  });

  it("finds a statement on a table before its temporary twin is created", () => {
    expect(
      unqualifiedTables(
        "x.ts",
        "tx.$queryRaw`SELECT 1 FROM task`;\ntx.$executeRaw`CREATE TEMP TABLE task (id int)`;",
      ),
    ).toEqual([{ file: "x.ts", line: 1, text: "FROM task" }]);
  });

  it("reads -- in a shell script as a flag, not a comment", () => {
    expect(
      unqualifiedTables("x.sh", "psql --command 'DELETE FROM task'"),
    ).toEqual([{ file: "x.sh", line: 1, text: "FROM task" }]);
  });

  it("reports the line of the table's keyword", () => {
    expect(
      unqualifiedTables(
        "x.ts",
        'const a = 1;\nconst b = sql`\n  SELECT 1 FROM "Job"`;\nconst c = "x\\nSELECT 1 FROM task";',
      ),
    ).toEqual([
      { file: "x.ts", line: 3, text: 'FROM "Job"' },
      { file: "x.ts", line: 5, text: "FROM task" },
    ]);
  });

  it("names only excluded paths that exist", () => {
    expect(
      Object.keys(EXCLUDED).filter((path) => !existsSync(join(ROOT, path))),
    ).toEqual([]);
  });

  it("leaves out an excluded file, not every path that starts like it", () => {
    const files = sourceFiles();
    expect(files).not.toContain(
      "packages/database/src/helpers/credit-bucket-owner-xor.test.ts",
    );
    expect(files).toContain(
      "packages/database/src/helpers/credit-bucket-owner-xor.ts",
    );
    expect(files.some((file) => file.includes("/prisma/migrations/"))).toBe(
      false,
    );
    expect(
      files.filter(
        (file) => !SCANNED.some((folder) => file.startsWith(folder)),
      ),
    ).toEqual([]);
  });

  it("enforces by path prefix", () => {
    expect(isEnforced("packages/database/src/helpers/x.ts")).toBe(true);
    expect(isEnforced("packages/databases/x.ts")).toBe(false);
    expect(isEnforced("apps/core/src/helpers/x.ts")).toBe(false);
  });

  it("reports unqualified table names and fails only where enforced", () => {
    const found = repositoryFindings(sourceFiles(), unqualifiedTables);
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
      found.filter(({ file }) => isEnforced(file)),
      HOW_TO_FIX,
    ).toEqual([]);
  });
});

describe("names passed to the SQL helpers", () => {
  it.each([
    ['sharedTable("usr")', "sharedTable: unknown table: usr"],
    ['netTable(network, "user")', "netTable: user is a shared table"],
    ['tables.sharedTable("Job")', "sharedTable: Job is a Network table"],
    [
      'netType("mainnet", "TaskStatus")',
      "netType: TaskStatus is a shared type",
    ],
    ['sharedType("AgentStatus")', "sharedType: AgentStatus is a Network type"],
    ["sharedTable(name)", "sharedTable: the name is not a literal"],
    ['netTable("user")', "netTable: the name is not a literal"],
    [
      'sql`SELECT 1 FROM ${netTable(requireNetwork(x), "usr")}`',
      "netTable: unknown table: usr",
    ],
  ])("finds %s", (code, text) => {
    expect(wrongHelperNames("x.ts", code)).toEqual([
      { file: "x.ts", line: 1, text },
    ]);
  });

  it.each([
    'sql`SELECT 1 FROM ${netTable(requireNetwork(x), "Job")}`',
    'tables.sharedTable("user")',
    'netTable("preprod", "_AgentTag")',
    'sharedType("TaskStatus")',
    "netType(network, `AgentStatus`)",
    '// sharedTable("usr")',
    "const text = 'sharedTable(\"usr\")';",
  ])("passes %s", (code) => {
    expect(wrongHelperNames("x.ts", code)).toEqual([]);
  });

  it("names only files that exist", () => {
    expect(
      Object.keys(NAMES_NOT_CHECKED).filter(
        (file) => !existsSync(join(ROOT, file)),
      ),
    ).toEqual([]);
  });

  it("passes only known names of the helper's side, anywhere in the repository", () => {
    const files = gitFiles([""], CODE_EXTENSIONS).filter(
      (file) => !(file in NAMES_NOT_CHECKED),
    );
    expect(
      repositoryFindings(files, wrongHelperNames),
      "Pass the SQL name of a table or enum of the helper's side, as a literal (packages/database/prisma/network-tables.json).",
    ).toEqual([]);
  });
});
