import { randomUUID } from "node:crypto";
import { backfillTaskWorkTypePresets } from "@sokosumi/database/helpers";
import {
  createSqlTables,
  sharedTable,
  sharedType,
} from "@sokosumi/database/sql-tables";
import { CURATED_VOCABULARY_VERSION, TASK_TAG_PRESETS } from "@sokosumi/utils";
import { expect, it } from "vitest";
import prisma from "@/lib/db/prisma";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

it.skipIf(!enabled).each(["UTC", "Europe/Berlin", "America/New_York"])(
  "backfills old workspaces in batches in %s, preserving collisions and later edits",
  async (zone) => {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('TimeZone', ${zone}, true)`;
      // The production statement scans all workspaces. Isolate it from other suites
      // in a scratch schema and copy the real label schema and unique index.
      // The backfill gets the scratch tables explicitly. Bare names cannot
      // resolve to them because the scratch schema stays off the search path.
      const schema = `task_presets_test_${randomUUID().replaceAll("-", "")}`;
      const scratch = createSqlTables({
        shared: schema,
        mainnet: "unused_mainnet",
        preprod: "unused_preprod",
        preprodOn: false,
      });
      const tables = { sharedTable: scratch.sharedTable, sharedType };
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRaw`CREATE TABLE ${tables.sharedTable("workspace")} (id uuid PRIMARY KEY)`;
      await tx.$executeRaw`CREATE TABLE ${tables.sharedTable("workspace_label")} (LIKE ${sharedTable("workspace_label")} INCLUDING ALL)`;
      const first = randomUUID();
      const second = randomUUID();
      await tx.$executeRaw`INSERT INTO ${tables.sharedTable("workspace")} (id) VALUES (${first}::uuid), (${second}::uuid)`;
      await tx.$executeRaw`
      INSERT INTO ${tables.sharedTable("workspace_label")} (id, "workspaceId", "updatedAt", kind, "displayName",
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
      const [{ utcStamps }] = await tx.$queryRaw<{ utcStamps: boolean }[]>`
        SELECT bool_and("createdAt" = (now() AT TIME ZONE 'UTC')::timestamp(3)
          AND "updatedAt" = (now() AT TIME ZONE 'UTC')::timestamp(3)) AS "utcStamps"
        FROM ${tables.sharedTable("workspace_label")} WHERE "workspaceId" = ${second}::uuid
      `;
      expect(utcStamps).toBe(true);
      const rows = await tx.$queryRaw<
        {
          displayName: string;
          description: string;
          vocabularyVersion: number;
          isTaskPreset: boolean;
        }[]
      >`
      SELECT "displayName", description, "vocabularyVersion", "isTaskPreset"
      FROM ${tables.sharedTable("workspace_label")} WHERE "workspaceId" = ${second}::uuid ORDER BY "displayName"
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
      FROM ${tables.sharedTable("workspace_label")} WHERE "workspaceId" = ${first}::uuid AND "normalizedName" = 'bug'
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
      await tx.$executeRaw`UPDATE ${tables.sharedTable("workspace_label")} SET "normalizedName"='team-bug', "displayName"='Team bug'
      WHERE "workspaceId" = ${second}::uuid AND "normalizedName"='bug'`;
      expect(
        await backfillTaskWorkTypePresets(tx, { batchSize: 1, tables }),
      ).toBe(0);
      await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    });
  },
);
