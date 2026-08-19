import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Convergence guards for the x402 payment migration.
 *
 * `20260819130000_task_x402_payment` is deliberately re-appliable: preview and
 * dev databases may already hold an earlier shape of the same file, so every
 * object it declares is restated idempotently and both paths (fresh CREATE and
 * already-created) must land on one shape.
 *
 * These tests derive their expectations from `schema.prisma` rather than
 * restating the SQL, so they fail when the model gains something the migration
 * does not converge on — the actual regression this file exists to catch.
 *
 * Runtime behaviour of the constraints themselves is only observable inside
 * Postgres and is validated by SQL probes against a real server, not here.
 */

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const schemaPath = join(packageRoot, "prisma/schema.prisma");
const x402MigrationPath = join(
  packageRoot,
  "prisma/migrations/20260819130000_task_x402_payment/migration.sql",
);

const NONCE_REPLAY_INDEX = "task_x402_payment_nonce_replay_uidx";
const NONCE_PAYER_CHECK = "task_x402_payment_nonce_payer_together_chk";
/**
 * The exact predicate, not just the columns it mentions. Both spellings of the
 * hole this closes — payer without nonce, and nonce without payer — are only
 * refused by the equality; an `OR`-shaped predicate naming the same columns
 * passes a substring check while permitting both.
 */
const NONCE_PAYER_PREDICATE =
  'CHECK (("payerAddress" IS NULL) = ("payloadNonce" IS NULL))';

function readSchema(): string {
  return readFileSync(schemaPath, "utf8");
}

function readX402Migration(): string {
  return readFileSync(x402MigrationPath, "utf8");
}

function enumMembers(schema: string, enumName: string): string[] {
  const match = schema.match(new RegExp(`enum ${enumName}\\s*\\{([^}]*)\\}`));
  expect(match, `enum ${enumName} in schema.prisma`).toBeTruthy();

  return (match?.[1] ?? "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => /^[A-Z][A-Z0-9_]*$/.test(line));
}

function modelBlock(schema: string, modelName: string): string {
  const match = schema.match(
    new RegExp(`model ${modelName}\\s*\\{([\\s\\S]*?)\\n\\}`),
  );
  expect(match, `model ${modelName} in schema.prisma`).toBeTruthy();
  return match?.[1] ?? "";
}

/** Columns listed in the `@@unique` carrying `map: "<indexName>"`. */
function mappedUniqueColumns(model: string, indexName: string): string[] {
  const match = model.match(
    new RegExp(`@@unique\\(\\[([^\\]]*)\\][^\\n]*map:\\s*"${indexName}"`),
  );
  expect(match, `@@unique mapped to ${indexName}`).toBeTruthy();

  return (match?.[1] ?? "").split(",").map((column) => column.trim());
}

/** Optional (`Type?`) scalar fields declared on a model block. */
function optionalScalarFields(model: string): Set<string> {
  const optional = new Set<string>();

  for (const line of model.split("\n")) {
    const match = line.trim().match(/^(\w+)\s+(\w+)\?/);
    if (match?.[1]) {
      optional.add(match[1]);
    }
  }

  return optional;
}

/** The body of the `CREATE TABLE … ("…")` statement for a table. */
function createTableBody(sql: string, tableName: string): string {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS "${tableName}" (`);
  expect(start, `CREATE TABLE for ${tableName}`).toBeGreaterThan(-1);

  const end = sql.indexOf("\n);", start);
  expect(end, `end of CREATE TABLE for ${tableName}`).toBeGreaterThan(start);

  return sql.slice(start, end);
}

describe("x402 migration convergence", () => {
  it("restates every TaskX402PaymentStatus member as an idempotent ALTER TYPE", () => {
    // The `DO $$ CREATE TYPE … EXCEPTION WHEN duplicate_object` guard swallows
    // the whole type when it already exists, so a database that applied an
    // earlier shape of this file keeps the old member set forever. Every other
    // object here converges via a restated statement; the enum must too, or
    // the next amendment strands preview/dev on a stale type and the app hits
    // `invalid input value for enum "TaskX402PaymentStatus"`.
    const members = enumMembers(readSchema(), "TaskX402PaymentStatus");
    const sql = readX402Migration();

    expect(members.length).toBeGreaterThan(0);

    for (const member of members) {
      expect(
        sql,
        `ALTER TYPE restatement for TaskX402PaymentStatus.${member}`,
      ).toContain(
        `ALTER TYPE "TaskX402PaymentStatus" ADD VALUE IF NOT EXISTS '${member}';`,
      );
    }
  });

  it("ties every nullable column of the nonce-replay unique together with a CHECK", () => {
    // Postgres btree uniques treat NULLs as distinct, and the partial
    // predicate only gates on `payloadNonce IS NOT NULL`. Two rows with a NULL
    // `payerAddress` and the same nonce therefore insert cleanly — two credit
    // debits behind one EIP-3009 authorization, exactly what the index claims
    // to prevent. The CHECK makes the tuple all-or-nothing so the index can
    // never see a half-populated key.
    const schema = readSchema();
    const model = modelBlock(schema, "TaskX402Payment");
    const optional = optionalScalarFields(model);

    const nullableReplayColumns = mappedUniqueColumns(
      model,
      NONCE_REPLAY_INDEX,
    ).filter((column) => optional.has(column));

    expect(nullableReplayColumns.length).toBeGreaterThan(1);

    const sql = readX402Migration();
    const checkStatements = sql
      .split("\n")
      .filter((line) => line.includes(NONCE_PAYER_CHECK));

    expect(
      checkStatements.length,
      `${NONCE_PAYER_CHECK} declared on both the CREATE and the converge path`,
    ).toBeGreaterThanOrEqual(2);

    for (const column of nullableReplayColumns) {
      expect(sql, `${NONCE_PAYER_CHECK} covers "${column}"`).toContain(
        `"${column}" IS NULL`,
      );
    }

    // Asserting the two column names appear is NOT enough: a predicate like
    // `(("payerAddress" IS NULL) OR ("payloadNonce" IS NULL) OR TRUE)` contains
    // both substrings, satisfies every check above, and is vacuously true —
    // reopening the NULL-payer nonce-replay hole this constraint exists to
    // close. Pin the whole equality, and pin it on BOTH paths.
    expect(
      checkStatements.length,
      `${NONCE_PAYER_PREDICATE} declared on both paths`,
    ).toBe(
      sql.split("\n").filter((line) => line.includes(NONCE_PAYER_PREDICATE))
        .length,
    );
  });

  it("declares the nonce/payer CHECK on both the fresh and the converge path", () => {
    // A database that already applied an earlier shape of this file skips the
    // CREATE TABLE entirely (IF NOT EXISTS), so a constraint declared only
    // inline never reaches it — the same discipline every FK here follows.
    const sql = readX402Migration();

    expect(
      createTableBody(sql, "task_x402_payment"),
      "inline CHECK on the fresh CREATE TABLE path",
    ).toContain(`CONSTRAINT "${NONCE_PAYER_CHECK}"`);

    expect(sql, "idempotent ADD CONSTRAINT on the converge path").toMatch(
      new RegExp(
        `ALTER TABLE "task_x402_payment"\\s*\\n?\\s*ADD CONSTRAINT "${NONCE_PAYER_CHECK}"`,
      ),
    );
  });
});
