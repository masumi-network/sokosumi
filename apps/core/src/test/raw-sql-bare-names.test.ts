import ts from "@typescript/typescript6";
import { describe, expect, it } from "vitest";

import { bareNames } from "./raw-sql-bare-names";

/** The finding in the first string or template of `code`. */
function found(code: string) {
  const source = ts.createSourceFile(
    "fixture.ts",
    code,
    ts.ScriptTarget.Latest,
    true,
  );
  let text: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node))
      text ??= node;
    else ts.forEachChild(node, visit);
  }
  visit(source);
  if (!text) throw new Error("The fixture has no string");
  return bareNames(text);
}

describe("bare names in raw SQL that PREPARE does not see", () => {
  it.each([
    [
      'Prisma.sql`EXISTS (SELECT 1 FROM "task" t WHERE t.id = ${id})`',
      'FROM "task"',
    ],
    [
      "Prisma.sql`exists (select 1 from task_file f where f.id = ${id})`",
      "from task_file",
    ],
    ["Prisma.sql`SELECT id FROM WORKSPACE`", "FROM WORKSPACE"],
    ['Prisma.sql`SELECT 1 FROM /* target */ "task"`', 'FROM "task"'],
    ['tx.$executeRawUnsafe("TRUNCATE task CASCADE")', "TRUNCATE task"],
    [
      "tx.$executeRaw`LOCK TABLE credit_bucket IN EXCLUSIVE MODE`",
      "TABLE credit_bucket",
    ],
    ['Prisma.sql`${value}::"TaskStatus"`', '::"TaskStatus"'],
    ['Prisma.sql`${value}::"AgentStatus"[]`', '::"AgentStatus"'],
    ["Prisma.sql`'it''s' = ${a} AND EXISTS (SELECT 1 FROM task)`", "FROM task"],
    ['tx.$executeRawUnsafe("-- cleanup\\nTRUNCATE task")', "TRUNCATE task"],
    ["Prisma.sql`x is_distinct FROM task`", "FROM task"],
  ])("finds the bare name in %s", (code, message) => {
    expect(found(code)).toEqual({ line: 1, message });
  });

  it.each([
    'Prisma.sql`EXISTS (SELECT 1 FROM ${sharedTable("task")} t WHERE t.id = ${id})`',
    'Prisma.sql`EXISTS (SELECT 1 FROM "shared"."task" t)`',
    'Prisma.sql`EXISTS (SELECT 1 FROM "shared" . "task" t)`',
    'tx.$executeRawUnsafe(`TRUNCATE ${netTable("mainnet", "Job").sql} CASCADE`)',
    "tx.$executeRaw`SAVEPOINT vendor_grant_create`",
    'Prisma.sql`${value}::${sharedType("TaskStatus")}`',
    'Prisma.sql`${value}::"shared"."TaskStatus"`',
    'Prisma.sql`${value}::"int4"`',
    "Prisma.sql`'[1]'::\"vector\"`",
    "Prisma.sql`note = 'copied from task'`",
    "Prisma.sql`note = 'moved ${count} rows from task'`",
    "Prisma.sql`note = 'cast::\"TaskStatus\"'`",
    "Prisma.sql`-- copied from task\n  SELECT 1`",
    "Prisma.sql`/* join workspace */ SELECT 1`",
    "Prisma.sql`SELECT $body$ copied from task $body$`",
    "Prisma.sql`a IS DISTINCT FROM organization AND b IS NOT DISTINCT FROM workspace`",
    "Prisma.sql`a is distinct from organization`",
    'tx.$queryRaw`SELECT ${flag ? "moved from task now" : "ok"} ${extra}`',
    'Prisma.sql`SELECT id FROM "WORKSPACE"`',
    'Prisma.sql`SELECT 1 FROM "task" . "in_a_schema_named_task"`',
    "Prisma.sql`SELECT id FROM task$archive`",
    "Prisma.sql`SELECT id FROM bucket_avail`",
    'Prisma.sql`EXTRACT(EPOCH FROM task."createdAt")`',
    'Prisma.sql`DO UPDATE SET "refundedAt" = "polar_order"."refundedAt"`',
    "tx.$executeRaw`CREATE TEMP TABLE workspace (id uuid) ON COMMIT DROP`",
    "tx.$executeRaw`CREATE LOCAL TEMPORARY TABLE workspace (id uuid)`",
  ])("passes %s", (code) => {
    expect(found(code)).toBeUndefined();
  });

  it("reports the line of the name, not of the keyword or the statement", () => {
    expect(
      found(
        'const where = Prisma.sql`\n  SELECT 1\n  FROM ${sharedTable("task")} t\n  JOIN\n    "Job" j ON true`;',
      ),
    ).toEqual({ line: 5, message: 'JOIN "Job"' });
  });

  it("keeps line and text after a character that changes length in lowercase", () => {
    expect(found("Prisma.sql`SELECT 1 AS İİ\nFROM task\nWHERE true`")).toEqual({
      line: 2,
      message: "FROM task",
    });
  });

  it("keeps the line when a one-line string has an escaped newline", () => {
    expect(found('tx.$queryRawUnsafe("SELECT 1\\nFROM task")')).toEqual({
      line: 1,
      message: "FROM task",
    });
  });

  // Correct SQL that fails: the step's `EXCEPTIONS` takes the message as is.
  it.each([
    [
      "a common table expression named like a table",
      "Prisma.sql`WITH task AS (SELECT 1) SELECT * FROM task\n  JOIN workspace ON true`",
      "FROM task, JOIN workspace",
    ],
    [
      "a temporary table after its CREATE",
      "tx.$executeRaw`INSERT INTO workspace SELECT 1`",
      "INTO workspace",
    ],
    [
      "a quoted identifier that reads like a table reference",
      'Prisma.sql`SELECT 1 AS "from task count"`',
      "from task",
    ],
    [
      "an escape string with a backslash-escaped quote",
      "Prisma.sql`SELECT E'it\\\\'s from task today'`",
      "from task",
    ],
    [
      "prose in a nested block comment",
      "Prisma.sql`/* outer /* inner */ from task */ SELECT 1`",
      "from task",
    ],
  ])("gives one message for %s", (_what, code, message) => {
    expect(found(code)?.message).toBe(message);
  });
});
