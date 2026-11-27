import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createSqlTables,
  sqlTableLayoutFromEnv,
} from "@sokosumi/database/sql-tables";
import { describe, expect, it } from "vitest";

import { withFixtureSchemas } from "@/test/split-layout";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const layout = sqlTableLayoutFromEnv(process.env);
const { sharedTable } = createSqlTables(layout);
const migration = readFileSync(
  new URL(
    "../../../../../packages/database/prisma/migrations/20261127140000_preprod_generation/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const SOKO_BOT_TABLES = [
  "soko_bot_turn",
  "soko_bot_delegation",
  "soko_bot_schedule",
] as const;
const TABLES = [...SOKO_BOT_TABLES, "chat_room_mention"] as const;

class Rollback extends Error {}

describe.skipIf(!enabled)("Preprod generation migration", () => {
  it("adds nullable columns without a default, rewrites no row, checks the mention's Network, and runs twice", async () => {
    await withFixtureSchemas(async (tx) => {
      // The old layout on the disposable worker database; the rollback puts
      // the columns, rows and catalog back after the test.
      for (const table of SOKO_BOT_TABLES) {
        await tx.$executeRaw`ALTER TABLE ${sharedTable(table)} DROP COLUMN "preprodGeneration"`;
      }
      await tx.$executeRaw`
        ALTER TABLE ${sharedTable("chat_room_mention")}
          DROP COLUMN "network", DROP COLUMN "preprodGeneration"`;

      const userId = randomUUID();
      await tx.user.create({
        data: {
          id: userId,
          name: "Old mention owner",
          email: `${userId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        select: { id: true },
      });
      const { id: workspaceId } = await tx.workspace.create({
        data: { userId },
        select: { id: true },
      });
      const { id: sokoBotId } = await tx.sokoBot.create({
        data: { userId, workspaceId },
        select: { id: true },
      });
      const { id: roomId } = await tx.chatRoom.create({
        data: {
          name: "Old room",
          kind: "direct",
          directKey: `old:${userId}`,
          createdByUserId: userId,
        },
        select: { id: true },
      });
      // The previous release's writers: no new column named.
      const oldRows = async () => {
        const { id: turnId } = await tx.sokoBotTurn.create({
          data: {
            network: "mainnet",
            sokoBotId,
            workspaceId,
            source: "CHAT",
            userMessage: "Old turn",
            deadlineAt: new Date(),
            capabilityNames: [],
            clientTurnId: randomUUID(),
          },
          select: { id: true },
        });
        const { id: delegationId } = await tx.sokoBotDelegation.create({
          data: {
            network: "mainnet",
            turnId,
            toolCallId: randomUUID(),
            kind: "TASK",
            action: "fixture",
          },
          select: { id: true },
        });
        const { id: scheduleId } = await tx.sokoBotSchedule.create({
          data: {
            network: "mainnet",
            sokoBotId,
            workspaceId,
            name: "Old schedule",
            timezone: "UTC",
            cronExpression: "0 * * * *",
            prompt: "Check in",
            nextRunAt: new Date(),
          },
          select: { id: true },
        });
        const { id: messageId } = await tx.chatRoomMessage.create({
          data: { roomId, senderUserId: userId, content: "@bot hello" },
          select: { id: true },
        });
        const { id: mentionId } = await tx.chatRoomMention.create({
          data: { messageId, sokoBotId },
          select: { id: true },
        });
        return [turnId, delegationId, scheduleId, mentionId] as const;
      };
      const before = await oldRows();
      const filenodes = () =>
        tx.$queryRaw<{ table: string; filenode: number }[]>`
          SELECT relname AS table, pg_relation_filenode(c.oid)::int AS filenode
          FROM pg_class c
          WHERE c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = ${layout.shared})
            AND c.relname = ANY(${[...TABLES]})
          ORDER BY relname`;
      const storage = await filenodes();

      await tx.$executeRawUnsafe(migration);

      // A new file node would mean PostgreSQL rewrote the table.
      expect(await filenodes()).toEqual(storage);
      const columns = await tx.$queryRaw<
        {
          table: string;
          column: string;
          type: string;
          nullable: string;
          default: string | null;
        }[]
      >`
        SELECT table_name AS table, column_name AS column, data_type AS type,
          is_nullable AS nullable, column_default AS default
        FROM information_schema.columns
        WHERE table_schema = ${layout.shared}
          AND table_name = ANY(${[...TABLES]})
          AND column_name IN ('preprodGeneration', 'network')
        ORDER BY table_name, column_name`;
      const column = (table: string, name: string, type: string) => ({
        table,
        column: name,
        type,
        nullable: "YES",
        default: null,
      });
      expect(columns).toEqual([
        column("chat_room_mention", "network", "text"),
        column("chat_room_mention", "preprodGeneration", "integer"),
        column("soko_bot_delegation", "network", "text"),
        column("soko_bot_delegation", "preprodGeneration", "integer"),
        column("soko_bot_schedule", "network", "text"),
        column("soko_bot_schedule", "preprodGeneration", "integer"),
        column("soko_bot_turn", "network", "text"),
        column("soko_bot_turn", "preprodGeneration", "integer"),
      ]);

      const readNew = async (ids: readonly string[]) => {
        const out: unknown[] = [];
        for (const [index, table] of TABLES.entries()) {
          const rows = await tx.$queryRaw<unknown[]>`
            SELECT "network", "preprodGeneration" FROM ${sharedTable(table)}
            WHERE "id" = ${ids[index]}::uuid`;
          out.push(...rows);
        }
        return out;
      };
      const legacy = [
        { network: "mainnet", preprodGeneration: null },
        { network: "mainnet", preprodGeneration: null },
        { network: "mainnet", preprodGeneration: null },
        { network: null, preprodGeneration: null },
      ];
      // No backfill, and an old writer still inserts without the columns.
      expect(await readNew(before)).toEqual(legacy);
      const after = await oldRows();
      expect(await readNew(after)).toEqual(legacy);

      const validated = await tx.$queryRaw<{ convalidated: boolean }[]>`
        SELECT convalidated FROM pg_constraint
        WHERE contype = 'c'
          AND conrelid = (
            SELECT c.oid FROM pg_class c
            WHERE c.relname = 'chat_room_mention'
              AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = ${layout.shared}))
          AND conname = 'chat_room_mention_network_check'`;
      expect(validated).toEqual([{ convalidated: true }]);

      const mentionTable = sharedTable("chat_room_mention");
      const { id: messageId } = await tx.chatRoomMessage.create({
        data: { roomId, senderUserId: userId, content: "@bot again" },
        select: { id: true },
      });
      const preprod = await tx.chatRoomMention.create({
        data: {
          messageId,
          sokoBotId,
          network: "preprod",
          preprodGeneration: 2,
        },
        select: { id: true },
      });
      await tx.$executeRawUnsafe("SAVEPOINT invalid_network");
      await expect(
        tx.$executeRaw`UPDATE ${mentionTable} SET "network" = 'testnet' WHERE "id" = ${preprod.id}::uuid`,
      ).rejects.toThrow("chat_room_mention_network_check");
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invalid_network");

      // A second run changes nothing and keeps what was written since.
      await tx.$executeRawUnsafe(migration);
      expect(await filenodes()).toEqual(storage);
      expect(await readNew(before)).toEqual(legacy);
      await expect(
        tx.chatRoomMention.findUniqueOrThrow({
          where: { id: preprod.id },
          select: { network: true, preprodGeneration: true },
        }),
      ).resolves.toEqual({ network: "preprod", preprodGeneration: 2 });
      throw new Rollback();
    }).catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });
  });
});
