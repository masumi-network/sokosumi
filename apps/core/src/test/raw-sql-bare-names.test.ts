import ts from "@typescript/typescript6";
import { describe, expect, it } from "vitest";

import { bareNames, sqlTexts } from "./raw-sql-bare-names";

/**
 * The bare names under the last statement of `code`, as the prepare step
 * reads it: `follow` is on for a `*RawUnsafe` statement only.
 */
function found(code: string, follow = false) {
  const host = ts.createCompilerHost({});
  host.getSourceFile = (name, languageVersion) =>
    name === "/fixture.ts"
      ? ts.createSourceFile(name, code, languageVersion, true)
      : undefined;
  const program = ts.createProgram(
    ["/fixture.ts"],
    { noLib: true, noResolve: true },
    host,
  );
  const statement = program.getSourceFile("/fixture.ts")?.statements.at(-1);
  if (!statement) throw new Error("The fixture has no statement");
  return [
    ...sqlTexts(statement, follow ? program.getTypeChecker() : undefined),
  ].flatMap(bareNames);
}

const PIECES = `function joins(user: string) {
  return \`LEFT JOIN TABLE_HERE r ON r."userId" = \${user}\`;
}
const order = "ORDER BY 1";
tx.$queryRawUnsafe(\`SELECT 1 \${joins("$1")} \${order}\`);`;

describe("bare names in raw SQL that PREPARE does not see", () => {
  it.each([
    [
      "a Prisma.sql fragment",
      'const where = Prisma.sql`EXISTS (SELECT 1 FROM "task" t WHERE t.id = ${id})`;',
      'FROM "task"',
    ],
    [
      "a fragment with lowercase keywords",
      "const where = Prisma.sql`exists (select 1 from task_file f where f.id = ${id})`;",
      "from task_file",
    ],
    [
      "a *RawUnsafe string",
      'tx.$executeRawUnsafe("TRUNCATE \\"Job\\" CASCADE");',
      'TRUNCATE "Job"',
    ],
    [
      "a command",
      "tx.$executeRaw`LOCK TABLE credit_bucket IN EXCLUSIVE MODE`;",
      "TABLE credit_bucket",
    ],
    [
      "a cast to a type",
      'const status = Prisma.sql`${value}::"TaskStatus"`;',
      '::"TaskStatus"',
    ],
  ])("finds a bare name in %s", (_kind, code, name) => {
    expect(found(code)).toEqual([{ line: 1, name }]);
  });

  it.each([
    'const where = Prisma.sql`EXISTS (SELECT 1 FROM ${sharedTable("task")} t WHERE t.id = ${id})`;',
    'const where = Prisma.sql`EXISTS (SELECT 1 FROM "shared"."task" t)`;',
    'tx.$executeRawUnsafe(`TRUNCATE ${netTable("mainnet", "Job").sql} CASCADE`);',
    "tx.$executeRaw`SAVEPOINT vendor_grant_create`;",
    'const status = Prisma.sql`${value}::${sharedType("TaskStatus")}`;',
    'const status = Prisma.sql`${value}::"shared"."TaskStatus"`;',
    'const age = Prisma.sql`EXTRACT(EPOCH FROM task."createdAt")`;',
    'const set = Prisma.sql`DO UPDATE SET "refundedAt" = "polar_order"."refundedAt"`;',
    "tx.$executeRaw`CREATE TEMP TABLE workspace (id uuid) ON COMMIT DROP`;",
    "const from = Prisma.sql`SELECT id FROM bucket_avail`;",
  ])("passes %s", (code) => {
    expect(found(code)).toEqual([]);
  });

  it("finds a bare name in a string piece a *RawUnsafe statement is built from", () => {
    expect(
      found(PIECES.replace("TABLE_HERE", "chat_room_read_state"), true),
    ).toEqual([{ line: 2, name: "JOIN chat_room_read_state" }]);
  });

  it("passes a string piece that names its table through the helper", () => {
    expect(
      found(
        PIECES.replace(
          "TABLE_HERE",
          '${sharedTable("chat_room_read_state").sql}',
        ),
        true,
      ),
    ).toEqual([]);
  });

  it("follows strings only, not every value a statement names", () => {
    expect(
      found(
        'const labels = { note: "copied from task" };\ntx.$queryRawUnsafe(`SELECT ${labels.size}`);',
        true,
      ),
    ).toEqual([]);
  });

  it("reports the line of the name, not of the statement", () => {
    expect(
      found(
        'const where = Prisma.sql`\n  SELECT 1\n  FROM ${sharedTable("task")} t\n  JOIN\n    "Job" j ON true`;',
      ),
    ).toEqual([{ line: 4, name: 'JOIN "Job"' }]);
  });
});
