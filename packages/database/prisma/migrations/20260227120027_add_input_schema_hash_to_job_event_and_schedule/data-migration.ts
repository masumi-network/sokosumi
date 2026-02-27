import "dotenv/config";

import { hashInputSchema } from "@sokosumi/masumi/hash";

import { createPrismaClient } from "../../../src/client.js";
import { Prisma } from "../../../src/generated/prisma/client.js";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const prisma = createPrismaClient(DATABASE_URL);

const BATCH_SIZE = 1000;

interface HashUpdate {
  id: string;
  inputSchemaHash: string;
}

interface BackfillSummary {
  scanned: number;
  updated: number;
  skippedInvalid: number;
}

function createSummary(): BackfillSummary {
  return {
    scanned: 0,
    updated: 0,
    skippedInvalid: 0,
  };
}

function buildHashUpdates(
  rows: Array<{
    id: string;
    inputSchema: string | null;
  }>,
): {
  updates: HashUpdate[];
  skippedInvalid: number;
} {
  const updates: HashUpdate[] = [];
  let skippedInvalid = 0;

  for (const row of rows) {
    const inputSchemaHash = hashInputSchema(row.inputSchema);
    if (!inputSchemaHash) {
      skippedInvalid += 1;
      continue;
    }

    updates.push({
      id: row.id,
      inputSchemaHash,
    });
  }

  return {
    updates,
    skippedInvalid,
  };
}

async function updateJobEventBatch(updates: HashUpdate[]): Promise<number> {
  if (updates.length === 0) {
    return 0;
  }

  return prisma.$executeRaw`
    UPDATE "jobEvent" AS target
    SET "inputSchemaHash" = payload."inputSchemaHash"
    FROM (
      VALUES ${Prisma.join(
        updates.map((update) => Prisma.sql`(${update.id}, ${update.inputSchemaHash})`),
      )}
    ) AS payload("id", "inputSchemaHash")
    WHERE target."id" = payload."id"
      AND target."inputSchemaHash" IS NULL
  `;
}

async function updateJobScheduleBatch(updates: HashUpdate[]): Promise<number> {
  if (updates.length === 0) {
    return 0;
  }

  return prisma.$executeRaw`
    UPDATE "jobSchedule" AS target
    SET "inputSchemaHash" = payload."inputSchemaHash"
    FROM (
      VALUES ${Prisma.join(
        updates.map((update) => Prisma.sql`(${update.id}, ${update.inputSchemaHash})`),
      )}
    ) AS payload("id", "inputSchemaHash")
    WHERE target."id" = payload."id"
      AND target."inputSchemaHash" IS NULL
  `;
}

async function ensureHashColumnsExist() {
  const rows = await prisma.$queryRaw<
    Array<{
      tableName: string;
      columnName: string;
    }>
  >`
    SELECT
      "table_name" as "tableName",
      "column_name" as "columnName"
    FROM information_schema.columns
    WHERE (
      "table_name" = 'jobEvent'
      OR "table_name" = 'jobSchedule'
    )
    AND "column_name" = 'inputSchemaHash'
  `;

  const found = new Set(
    rows.map((row) => `${row.tableName}.${row.columnName}`),
  );

  const missingTargets = [
    "jobEvent.inputSchemaHash",
    "jobSchedule.inputSchemaHash",
  ].filter((target) => !found.has(target));

  if (missingTargets.length > 0) {
    throw new Error(
      `Missing columns: ${missingTargets.join(", ")}. Run prisma migration first.`,
    );
  }
}

async function backfillJobEventInputSchemaHash(): Promise<BackfillSummary> {
  const summary = createSummary();
  let cursor: string | undefined;
  let batchNumber = 0;

  while (true) {
    const rows = await prisma.jobEvent.findMany({
      where: {
        inputSchema: {
          not: null,
        },
        inputSchemaHash: null,
      },
      select: {
        id: true,
        inputSchema: true,
      },
      orderBy: {
        id: "asc",
      },
      take: BATCH_SIZE,
      ...(cursor
        ? {
            cursor: {
              id: cursor,
            },
            skip: 1,
          }
        : {}),
    });

    if (rows.length === 0) {
      break;
    }

    batchNumber += 1;
    summary.scanned += rows.length;
    cursor = rows[rows.length - 1]?.id;

    const { updates, skippedInvalid } = buildHashUpdates(rows);
    summary.skippedInvalid += skippedInvalid;
    summary.updated += await updateJobEventBatch(updates);

    console.log(
      `jobEvent batch=${batchNumber} scanned=${summary.scanned} updated=${summary.updated} skippedInvalid=${summary.skippedInvalid}`,
    );
  }

  return summary;
}

async function backfillJobScheduleInputSchemaHash(): Promise<BackfillSummary> {
  const summary = createSummary();
  let cursor: string | undefined;
  let batchNumber = 0;

  while (true) {
    const rows = await prisma.jobSchedule.findMany({
      where: {
        inputSchemaHash: null,
      },
      select: {
        id: true,
        inputSchema: true,
      },
      orderBy: {
        id: "asc",
      },
      take: BATCH_SIZE,
      ...(cursor
        ? {
            cursor: {
              id: cursor,
            },
            skip: 1,
          }
        : {}),
    });

    if (rows.length === 0) {
      break;
    }

    batchNumber += 1;
    summary.scanned += rows.length;
    cursor = rows[rows.length - 1]?.id;

    const { updates, skippedInvalid } = buildHashUpdates(rows);
    summary.skippedInvalid += skippedInvalid;
    summary.updated += await updateJobScheduleBatch(updates);

    console.log(
      `jobSchedule batch=${batchNumber} scanned=${summary.scanned} updated=${summary.updated} skippedInvalid=${summary.skippedInvalid}`,
    );
  }

  return summary;
}

async function main() {
  await ensureHashColumnsExist();

  const eventSummary = await backfillJobEventInputSchemaHash();
  const scheduleSummary = await backfillJobScheduleInputSchemaHash();

  console.log(
    `jobEvent inputSchemaHash backfill scanned=${eventSummary.scanned} updated=${eventSummary.updated} skippedInvalid=${eventSummary.skippedInvalid}`,
  );
  console.log(
    `jobSchedule inputSchemaHash backfill scanned=${scheduleSummary.scanned} updated=${scheduleSummary.updated} skippedInvalid=${scheduleSummary.skippedInvalid}`,
  );
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
