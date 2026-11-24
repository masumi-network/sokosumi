import { randomUUID } from "node:crypto";
import { PrismaRaw } from "@sokosumi/database/client";
import { backfillTaskWorkTypePresets } from "@sokosumi/database/helpers";
import { sharedType } from "@sokosumi/database/sql-tables";
import { CURATED_VOCABULARY_VERSION, TASK_TAG_PRESETS } from "@sokosumi/utils";
import { expect, it } from "vitest";
import prisma from "@/lib/db/prisma";

// The statement names its tables with their schema, so the temporary tables
// below do not shadow the real ones: the backfill is told where they are.
const tables = {
  sharedTable: (table: string) => PrismaRaw.raw(`pg_temp."${table}"`),
  sharedType,
};

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

it.skipIf(!enabled)(
  "backfills old workspaces in batches, preserving collisions and later edits",
  async () => {
    await prisma.$transaction(async (tx) => {
      // The production statement scans all workspaces. Isolate it from other suites
      // with transaction-local tables and copy the real label schema and unique index.
      await tx.$executeRaw`CREATE TEMP TABLE workspace (id uuid PRIMARY KEY) ON COMMIT DROP`;
      await tx.$executeRaw`CREATE TEMP TABLE workspace_label (LIKE public.workspace_label INCLUDING ALL) ON COMMIT DROP`;
      const first = randomUUID();
      const second = randomUUID();
      await tx.$executeRaw`INSERT INTO workspace (id) VALUES (${first}::uuid), (${second}::uuid)`;
      await tx.$executeRaw`
      INSERT INTO workspace_label (id, "workspaceId", "updatedAt", kind, "displayName",
        "normalizedName", description, aliases, "createdByUserId", "archivedAt")
      VALUES (gen_random_uuid(), ${first}::uuid, NOW(), 'TAG', 'BUG', 'bug',
        'Saved by the team', ARRAY[]::text[], 'member', NOW())
    `;
      const expected = 2 * TASK_TAG_PRESETS.length - 1;
      expect(
        await backfillTaskWorkTypePresets(tx, {
          batchSize: 1,
          dryRun: true,
          tables,
        }),
      ).toBe(expected);
      expect(
        await backfillTaskWorkTypePresets(tx, { batchSize: 1, tables }),
      ).toBe(expected);
      const rows = await tx.$queryRaw<
        {
          displayName: string;
          description: string;
          vocabularyVersion: number;
          isTaskPreset: boolean;
        }[]
      >`
      SELECT "displayName", description, "vocabularyVersion", "isTaskPreset"
      FROM workspace_label WHERE "workspaceId" = ${second}::uuid ORDER BY "displayName"
    `;
      expect(rows).toEqual(
        TASK_TAG_PRESETS.map(({ displayName, description }) => ({
          displayName,
          description,
          vocabularyVersion: CURATED_VOCABULARY_VERSION,
          isTaskPreset: true,
        })).sort((a, b) => a.displayName.localeCompare(b.displayName)),
      );
      expect(
        await tx.$queryRaw`
      SELECT "displayName", description, "createdByUserId", "isTaskPreset", "archivedAt" IS NOT NULL AS archived
      FROM workspace_label WHERE "workspaceId" = ${first}::uuid AND "normalizedName" = 'bug'
    `,
      ).toEqual([
        {
          displayName: "BUG",
          description: "Saved by the team",
          createdByUserId: "member",
          isTaskPreset: false,
          archived: true,
        },
      ]);
      await tx.$executeRaw`UPDATE workspace_label SET "normalizedName"='team-bug', "displayName"='Team bug'
      WHERE "workspaceId" = ${second}::uuid AND "normalizedName"='bug'`;
      expect(
        await backfillTaskWorkTypePresets(tx, { batchSize: 1, tables }),
      ).toBe(0);
    });
  },
);
