import "dotenv/config";

import { hashInputSchema } from "@sokosumi/masumi/hash";

import { createPrismaClient } from "../../../src/client.js";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const prisma = createPrismaClient(DATABASE_URL);

const BATCH_SIZE = 500;

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

async function backfillJobEventInputSchemaHash(): Promise<BackfillSummary> {
  const summary = createSummary();
  let cursor: string | undefined;

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

    summary.scanned += rows.length;
    cursor = rows[rows.length - 1]?.id;

    const updates = rows.flatMap((row) => {
      const inputSchemaHash = hashInputSchema(row.inputSchema);
      if (!inputSchemaHash) {
        summary.skippedInvalid += 1;
        return [];
      }

      summary.updated += 1;
      return prisma.jobEvent.update({
        where: {
          id: row.id,
        },
        data: {
          inputSchemaHash,
        },
      });
    });

    if (updates.length > 0) {
      await prisma.$transaction(updates);
    }
  }

  return summary;
}

async function backfillJobScheduleInputSchemaHash(): Promise<BackfillSummary> {
  const summary = createSummary();
  let cursor: string | undefined;

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

    summary.scanned += rows.length;
    cursor = rows[rows.length - 1]?.id;

    const updates = rows.flatMap((row) => {
      const inputSchemaHash = hashInputSchema(row.inputSchema);
      if (!inputSchemaHash) {
        summary.skippedInvalid += 1;
        return [];
      }

      summary.updated += 1;
      return prisma.jobSchedule.update({
        where: {
          id: row.id,
        },
        data: {
          inputSchemaHash,
        },
      });
    });

    if (updates.length > 0) {
      await prisma.$transaction(updates);
    }
  }

  return summary;
}

async function main() {
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
