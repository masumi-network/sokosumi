import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { TaskX402PaymentStatus } from "../../generated/prisma/enums.js";
import {
  listMigrationSql,
  modelBlock,
  packageRoot,
  readMigrationSql,
} from "./schema-fixtures.js";

/**
 * Convergence guards for the x402 payment migration.
 *
 * `20260819130000_task_x402_payment` keeps its idempotent fresh-install shape,
 * while later amendments also live in forward migrations because Prisma never
 * re-runs an already-applied migration name. Both fresh and previously-created
 * databases must therefore land on one shape.
 *
 * These tests derive their expectations from `schema.prisma` rather than
 * restating the SQL, so they fail when the model gains something the migration
 * does not converge on — the actual regression this file exists to catch.
 *
 * Runtime behaviour of the constraints themselves is only observable inside
 * Postgres and is validated by SQL probes against a real server, not here.
 */

const x402MigrationName = "20260819130000_task_x402_payment";
const publishedMigrationChecksums = new Map([
  [
    x402MigrationName,
    "171f3b4512af86741975a4dcbbd5fef9743ab46eebcc82c5693baf936d3a303c",
  ],
  [
    "20260812100000_task_x402_payment_refund_kind",
    "72bb3afe16d9feb94f16d67c44feb432007b263fd414fb4032f837801e323fd1",
  ],
  [
    "20260819150000_replay_agent_sync_for_dynamic_pricing",
    "41d1f83affe61965cf32f6e144b977ae407a21ea852395e9de931ddb5ab23012",
  ],
]);

/**
 * Checksums observed for the shapes published under the same base name.
 * They are history, not accepted current contents. Keeping the ledger beside
 * the pinned final checksum makes the convergence migration's compatibility
 * target explicit and prevents another silent amendment from becoming a
 * seventh.
 */
const historicalX402BaseMigrationChecksums = [
  "9d7f40101751ff1706539e3b954acf5df00f1a82030c5cdc8f45b563a68c52de",
  "1f4483552b636c4b5d1dbc5eaed7e8398d99abe4300c0579b5d96b0496c6eecf",
  "c220d318bb31cff88a85130966f52ddd7f4670591df551fc4c2285fd3ed49f79",
  "87f7be0337a42c845fe01dfd2578c85657adaac5e9a63b4c350f26203d978bd0",
  "4282bde675d636fd15635607918478bdddc2c0d0ed7a03556a5060598912813c",
  "171f3b4512af86741975a4dcbbd5fef9743ab46eebcc82c5693baf936d3a303c",
] as const;

const NONCE_REPLAY_INDEX = "task_x402_payment_nonce_replay_uidx";
const NONCE_PAYER_CHECK = "task_x402_payment_nonce_payer_together_chk";
const REPLAY_KEY_CANONICAL_CHECK = "task_x402_payment_replay_key_canonical_chk";
/**
 * The exact predicate, not just the columns it mentions. Both spellings of the
 * hole this closes — payer without nonce, and nonce without payer — are only
 * refused by the equality; an `OR`-shaped predicate naming the same columns
 * passes a substring check while permitting both.
 */
const NONCE_PAYER_PREDICATE =
  'CHECK (("payerAddress" IS NULL) = ("payloadNonce" IS NULL))';

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The constraint NAME adjacent to its exact predicate, as ONE declaration
 * (`ADD ` optional so it matches both the inline CREATE TABLE form and the
 * `ALTER TABLE … ADD` form). Matching name and predicate separately would let
 * disjoint sets satisfy the checks — a named-but-weakened constraint plus an
 * orphaned copy of the predicate text elsewhere in the file.
 */
const NONCE_PAYER_PAIRED_DECLARATION = new RegExp(
  `(?:ADD )?CONSTRAINT "${NONCE_PAYER_CHECK}"\\s+${escapeRegExp(
    NONCE_PAYER_PREDICATE,
  )}`,
);

// Hoisted reads: migration files are immutable for the lifetime of a run, so
// per-test rereads were pure I/O overhead.
const baseSql = readMigrationSql(x402MigrationName);
const replayCanonicalSql = readMigrationSql(
  "20260816130000_task_x402_payment_replay_key_canonical",
);
const actionLedgerSnapshotSql = readMigrationSql(
  "20260817100000_task_x402_payment_action_ledger_snapshot",
);
const fullConvergenceSql = readMigrationSql(
  "20260817110000_task_x402_payment_full_convergence",
);
const durableFailureSql = readMigrationSql(
  "20260817120000_task_x402_payment_durable_failures",
);
const creditCostCanonicalSql = readMigrationSql(
  "20260816140000_credit_cost_unit_canonical",
);
const signRiskSql = readMigrationSql(
  "20260817090000_task_x402_payment_sign_risk_expiry",
);
const actionRolloutGuardSql = readMigrationSql(
  "20260817130000_task_x402_payment_action_rollout_guard",
);

function orderedMigrationSqlAfter(migrationName: string) {
  return listMigrationSql().filter(({ name }) => name > migrationName);
}

/**
 * Enum member captures are deliberately WIDE (`[^']+`, not `[A-Z][A-Z0-9_]*`):
 * a narrow class would silently drop an unconventionally-spelled member from
 * the scrape, and the reachability equality below would then pass while blind
 * to it. With the wide capture, any spelling mismatch surfaces as a loud
 * array inequality instead.
 */
function createdEnumMembers(sql: string, enumName: string): string[] {
  const match = sql.match(
    new RegExp(`CREATE TYPE "${enumName}" AS ENUM \\(([^)]*)\\)`),
  );
  expect(match, `CREATE TYPE ${enumName}`).toBeTruthy();
  return Array.from((match?.[1] ?? "").matchAll(/'([^']+)'/g)).map(
    (member) => member[1] ?? "",
  );
}

function addedEnumMembers(sql: string, enumName: string): string[] {
  return Array.from(
    sql.matchAll(
      new RegExp(
        `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS '([^']+)';`,
        "g",
      ),
    ),
  ).map((member) => member[1] ?? "");
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
  it("keeps already-published migration files byte-for-byte immutable", () => {
    for (const [
      migrationName,
      expectedChecksum,
    ] of publishedMigrationChecksums) {
      const migration = readFileSync(
        join(packageRoot, "prisma/migrations", migrationName, "migration.sql"),
      );

      expect(
        createHash("sha256").update(migration).digest("hex"),
        `${migrationName} checksum`,
      ).toBe(expectedChecksum);
    }

    expect(new Set(historicalX402BaseMigrationChecksums).size).toBe(6);
    expect(historicalX402BaseMigrationChecksums.at(-1)).toBe(
      publishedMigrationChecksums.get(x402MigrationName),
    );
  });

  it("adds FK-free action ledger snapshots in a forward migration", () => {
    const model = modelBlock("TaskX402PaymentAction");
    const sql = actionLedgerSnapshotSql;
    const snapshotColumns = [
      "chargedOrganizationId",
      "chargeTransactionId",
      "refundTransactionId",
    ];

    for (const column of snapshotColumns) {
      expect(
        model,
        `${column} remains a nullable legacy-compatible scalar`,
      ).toMatch(new RegExp(`^\\s*${column}\\s+String\\?`, "m"));
      expect(sql, `forward migration adds ${column}`).toContain(
        `ADD COLUMN IF NOT EXISTS "${column}" TEXT`,
      );
    }

    expect(sql, "snapshot columns stay FK-free").not.toMatch(
      /(?:chargedOrganizationId|chargeTransactionId|refundTransactionId)[\s\S]{0,120}REFERENCES/,
    );
    expect(
      sql,
      "surviving payments backfill from the exact Prisma table",
    ).toContain('INNER JOIN "Transaction" AS charge');
  });

  it("evolves TaskX402PaymentStatus through ordered forward migrations", () => {
    const enumName = "TaskX402PaymentStatus";
    // The generated Prisma enum, not a regex scrape of schema.prisma: the
    // generated object is what every writer actually imports, so comparing
    // reachable-migration members against it cannot drift from the club the
    // application code is in — and it needs no third member-shaped regex that
    // could silently disagree with the two SQL scrapes below.
    const schemaMembers = Object.values(TaskX402PaymentStatus);
    const baseMembers = createdEnumMembers(baseSql, enumName);
    const seen = new Set<string>(baseMembers);

    for (const migration of orderedMigrationSqlAfter(x402MigrationName)) {
      for (const member of addedEnumMembers(migration.sql, enumName)) {
        if (!seen.has(member)) {
          const addStatement = `ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS '${member}';`;
          expect(
            migration.sql.replace(addStatement, ""),
            `${migration.name} must only introduce ${member}; use it in a later migration`,
          ).not.toContain(`'${member}'`);
          seen.add(member);
        }
      }
    }

    expect(
      [...seen],
      "schema enum is reachable from immutable migration history",
    ).toEqual(schemaMembers);
  });

  it("converges every historical payment and action column bound", () => {
    const sql = fullConvergenceSql;
    const paymentBounds = new Map([
      ["idempotencyKey", 200],
      ["caip2Network", 64],
      ["asset", 128],
      ["payerAddress", 42],
      ["payloadNonce", 66],
    ]);
    const actionBounds = new Map([
      ["reason", 500],
      ["asset", 128],
      ["caip2Network", 64],
    ]);

    for (const [column, length] of paymentBounds) {
      expect(sql, `payment ${column} overflow preflight`).toContain(
        `CHAR_LENGTH("${column}") > ${length}`,
      );
      expect(sql, `payment ${column} VARCHAR bound`).toContain(
        `ALTER COLUMN "${column}" TYPE VARCHAR(${length})`,
      );
    }
    for (const [column, length] of actionBounds) {
      expect(sql, `action ${column} overflow preflight`).toContain(
        `CHAR_LENGTH("${column}") > ${length}`,
      );
      expect(sql, `action ${column} VARCHAR bound`).toContain(
        `ALTER COLUMN "${column}" TYPE VARCHAR(${length})`,
      );
    }
  });

  it("backfills and requires every non-null action snapshot field", () => {
    const model = modelBlock("TaskX402PaymentAction");
    const optional = optionalScalarFields(model);
    const sql = fullConvergenceSql;
    const requiredSnapshots = [
      "cents",
      "amount",
      "asset",
      "caip2Network",
      "taskId",
      "agentId",
      "chargedUserId",
    ];

    expect(sql).toContain('INNER JOIN "task_x402_payment" AS payment');
    expect(sql).toContain('INNER JOIN "Transaction" AS charge');
    expect(sql).toContain("one or more legacy rows cannot be reconstructed");
    for (const column of requiredSnapshots) {
      expect(model, `${column} exists in schema`).toMatch(
        new RegExp(`^\\s*${column}\\s+\\w+`, "m"),
      );
      expect(optional, `${column} is required in schema`).not.toContain(column);
      expect(sql, `${column} added for oldest base shape`).toContain(
        `ADD COLUMN IF NOT EXISTS "${column}"`,
      );
      expect(sql, `${column} backfilled`).toContain(`"${column}" =`);
      expect(sql, `${column} made NOT NULL`).toContain(
        `ALTER COLUMN "${column}" SET NOT NULL`,
      );
    }
  });

  it("preflights replay duplicates before restoring the unique index", () => {
    const sql = fullConvergenceSql;
    const preflight = sql.indexOf("duplicate replay keys exist");
    const createUnique = sql.indexOf(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${NONCE_REPLAY_INDEX}"`,
    );

    expect(preflight).toBeGreaterThan(-1);
    expect(createUnique).toBeGreaterThan(preflight);
    expect(
      sql.slice(0, createUnique),
      "exact replay-key duplicate grouping",
    ).toContain(
      'GROUP BY "caip2Network", "asset", "payerAddress", "payloadNonce"',
    );
    expect(sql.slice(createUnique), "exact partial replay unique").toContain(
      'ON "task_x402_payment" ("caip2Network", "asset", "payerAddress", "payloadNonce")\n' +
        '  WHERE "payloadNonce" IS NOT NULL',
    );
  });

  it("ties every nullable column of the nonce-replay unique together with a CHECK", () => {
    // Postgres btree uniques treat NULLs as distinct, and the partial
    // predicate only gates on `payloadNonce IS NOT NULL`. Two rows with a NULL
    // `payerAddress` and the same nonce therefore insert cleanly — two credit
    // debits behind one EIP-3009 authorization, exactly what the index claims
    // to prevent. The CHECK makes the tuple all-or-nothing so the index can
    // never see a half-populated key.
    const model = modelBlock("TaskX402Payment");
    const optional = optionalScalarFields(model);

    const nullableReplayColumns = mappedUniqueColumns(
      model,
      NONCE_REPLAY_INDEX,
    ).filter((column) => optional.has(column));

    expect(nullableReplayColumns.length).toBeGreaterThan(1);

    for (const column of nullableReplayColumns) {
      expect(baseSql, `${NONCE_PAYER_CHECK} covers "${column}"`).toContain(
        `"${column}" IS NULL`,
      );
    }

    // Counted as PAIRED declarations, exactly 2: the inline CREATE TABLE form
    // and the converge-path ADD. Counting the name and the predicate
    // separately (as this test once did) let disjoint line sets satisfy it —
    // two named-but-weakened constraints plus two orphaned copies of the
    // predicate text elsewhere would have passed, with the NULL-payer
    // nonce-replay hole open. A predicate like
    // `(("payerAddress" IS NULL) OR ("payloadNonce" IS NULL) OR TRUE)` also
    // contains both column substrings while being vacuously true; only the
    // adjacent full equality rules every such spelling out.
    expect(
      baseSql.match(new RegExp(NONCE_PAYER_PAIRED_DECLARATION.source, "g"))
        ?.length,
      `${NONCE_PAYER_CHECK} paired with its exact predicate on both paths`,
    ).toBe(2);
  });

  it("declares the nonce/payer CHECK on both the fresh and the converge path", () => {
    // A database that already applied an earlier shape of this file skips the
    // CREATE TABLE entirely (IF NOT EXISTS), so a constraint declared only
    // inline never reaches it — the same discipline every FK here follows.
    // Every path is matched as name-plus-exact-predicate: a name-only match
    // would accept a renamed or weakened CHECK on any of them.
    expect(
      createTableBody(baseSql, "task_x402_payment"),
      "inline CHECK on the fresh CREATE TABLE path",
    ).toMatch(NONCE_PAYER_PAIRED_DECLARATION);

    expect(baseSql, "idempotent ADD CONSTRAINT on the converge path").toMatch(
      new RegExp(
        `ALTER TABLE "task_x402_payment"\\s*\\n?\\s*ADD CONSTRAINT "${NONCE_PAYER_CHECK}"\\s+${escapeRegExp(
          NONCE_PAYER_PREDICATE,
        )}`,
      ),
    );
    expect(
      replayCanonicalSql,
      "forward migration for databases that already applied the base name",
    ).toMatch(NONCE_PAYER_PAIRED_DECLARATION);
    expect(
      fullConvergenceSql,
      "final convergence for every published base shape",
    ).toMatch(NONCE_PAYER_PAIRED_DECLARATION);
  });

  it("requires canonical lowercase spellings for every replay-key column", () => {
    const model = modelBlock("TaskX402Payment");
    const replayColumns = mappedUniqueColumns(model, NONCE_REPLAY_INDEX);
    const sql = replayCanonicalSql;

    expect(
      baseSql,
      "an already-applied migration must keep its original checksum",
    ).not.toContain(REPLAY_KEY_CANONICAL_CHECK);

    for (const column of replayColumns) {
      expect(
        sql,
        `${REPLAY_KEY_CANONICAL_CHECK} canonicalizes "${column}"`,
      ).toContain(`"${column}" = LOWER("${column}")`);
    }

    expect(sql, "forward canonical CHECK migration").toMatch(
      new RegExp(
        `ALTER TABLE "task_x402_payment"\\s*\\n?\\s*ADD CONSTRAINT "${REPLAY_KEY_CANONICAL_CHECK}"`,
      ),
    );
    expect(sql, "existing rows normalized before the CHECK").toMatch(
      /UPDATE "task_x402_payment"[\s\S]*SET[\s\S]*LOWER\("caip2Network"\)/,
    );
    expect(
      sql.indexOf("CREATE TRIGGER"),
      "old deployment writers are normalized before the CHECK lands",
    ).toBeLessThan(
      sql.indexOf(`ADD CONSTRAINT "${REPLAY_KEY_CANONICAL_CHECK}"`),
    );
    expect(sql, "case-folded collisions fail before normalization").toContain(
      "case-folded duplicates exist",
    );
  });

  it("keeps automated failure outcomes durable across rolling deploys and deletion", () => {
    const model = modelBlock("TaskX402PaymentAction");
    const sql = durableFailureSql;

    expect(model).toContain(
      '@@unique([paymentId], map: "task_x402_payment_action_failure_payment_uidx", where: { action: "failure" })',
    );
    expect(sql).toContain("WHERE payment.\"status\" = 'FAILED'");
    expect(sql).toContain("'system:x402'");
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION "record_task_x402_payment_failure_outcome"()',
    );
    expect(sql).toContain(
      'AFTER INSERT OR UPDATE OF "status", "refundTransactionId"',
    );
    expect(sql).toContain(
      `ON CONFLICT ("paymentId") WHERE "action" = 'failure' DO NOTHING`,
    );
    expect(sql.indexOf("CREATE TRIGGER")).toBeLessThan(
      sql.indexOf("-- Backfill only after trigger activation"),
    );
    expect(sql.indexOf("BEGIN;")).toBeLessThan(sql.indexOf("LOCK TABLE"));
    expect(sql.indexOf("LOCK TABLE")).toBeLessThan(
      sql.indexOf("CREATE UNIQUE INDEX"),
    );
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("canonicalizes CreditCost units for old writers before enforcing the check", () => {
    const sql = creditCostCanonicalSql;

    for (const asciiWhitespaceCode of [9, 10, 11, 12, 13, 32]) {
      expect(sql).toContain(`CHR(${asciiWhitespaceCode})`);
    }
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF "unit"');
    expect(sql.indexOf("CREATE TRIGGER")).toBeLessThan(
      sql.indexOf('ADD CONSTRAINT "credit_cost_unit_canonical_chk"'),
    );
    expect(sql).toContain(
      'CHECK ("unit" = public."canonical_credit_cost_unit"("unit"))',
    );
  });

  it("gives every legacy PENDING row a conservative resolvable risk window", () => {
    const sql = signRiskSql;

    expect(sql).toContain(
      '"processingAt" = COALESCE("processingAt", "updatedAt", "createdAt")',
    );
    expect(sql).toContain("WHERE \"status\" = 'PENDING'");
    expect(sql).not.toContain('"processingAt" IS NOT NULL');
  });

  it("fills old-writer operator action snapshots before the final backfill", () => {
    const sql = actionRolloutGuardSql;

    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION "complete_task_x402_payment_action_snapshot"()',
    );
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF");
    expect(sql.indexOf("CREATE TRIGGER")).toBeLessThan(
      sql.indexOf('UPDATE "task_x402_payment_action" AS action'),
    );
    expect(sql.indexOf("BEGIN;")).toBeLessThan(sql.indexOf("LOCK TABLE"));
    expect(sql.indexOf("LOCK TABLE")).toBeLessThan(
      sql.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    expect(sql).toContain(
      "Cannot write incomplete task x402 action snapshot without its source payment",
    );
    expect(sql).toContain('INNER JOIN "task_x402_payment" AS payment');
    expect(sql).toContain(
      "Cannot complete recoverable task x402 action snapshot",
    );
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    for (const column of [
      "chargedOrganizationId",
      "chargeTransactionId",
      "refundTransactionId",
    ]) {
      expect(sql).toContain(`NEW."${column}"`);
    }
  });
});
