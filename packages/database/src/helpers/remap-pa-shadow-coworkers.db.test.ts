import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { Client } from "pg";
import { describe, expect, it } from "vitest";

const CUTOVER_MIGRATION = "20260902140000_pa_orchestrator_chat_task_cutover";
const execFileAsync = promisify(execFile);
const migrationsDirectory = path.resolve(
  import.meta.dirname,
  "../../prisma/migrations",
);
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase =
  databaseUrl && process.env.RUN_DATABASE_INTEGRATION_TESTS === "true"
    ? describe
    : describe.skip;

function databaseConnectionUrl(databaseName: string): string {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  url.search = "";
  return url.toString();
}

async function applyPreCutoverMigrations(client: Client): Promise<void> {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.isDirectory() && entry.name < CUTOVER_MIGRATION)
    .map((entry) => entry.name)
    .sort();

  for (const migration of migrations) {
    const sql = await readFile(
      path.join(migrationsDirectory, migration, "migration.sql"),
      "utf8",
    );
    try {
      await client.query(sql);
    } catch (error) {
      throw new Error(`Failed to apply pre-cutover migration ${migration}`, {
        cause: error,
      });
    }
  }
}

async function withPreCutoverDatabase(
  run: (client: Client, connectionUrl: string) => Promise<void>,
): Promise<void> {
  const databaseName = `pa_cutover_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Client({
    connectionString: databaseConnectionUrl("postgres"),
  });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const connectionUrl = databaseConnectionUrl(databaseName);
    const client = new Client({
      connectionString: connectionUrl,
    });
    await client.connect();
    try {
      await applyPreCutoverMigrations(client);
      await run(client, connectionUrl);
    } finally {
      await client.end();
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
}

async function insertPreCutoverFixture(client: Client): Promise<void> {
  await client.query(`
    INSERT INTO "user" (
      id, name, email, "emailVerified", "createdAt", "updatedAt"
    ) VALUES (
      'cutover-user', 'Cutover User', 'cutover@example.test', true, NOW(), NOW()
    );

    INSERT INTO workspace (id, "userId", "createdAt", "updatedAt") VALUES
      ('10000000-0000-4000-8000-000000000001', 'cutover-user', NOW(), NOW());

    INSERT INTO vendor (id, name, slug, "createdAt", "updatedAt") VALUES
      ('20000000-0000-4000-8000-000000000001', 'PA shadows', 'pa-shadows', NOW(), NOW());

    INSERT INTO orchestrator (
      id, "userId", "workspaceId", name, "createdAt", "updatedAt"
    ) VALUES
      (
        '30000000-0000-4000-8000-000000000002',
        'cutover-user',
        '10000000-0000-4000-8000-000000000001',
        'Second Bot',
        NOW(),
        NOW()
      );

    INSERT INTO "user" (
      id, name, email, "emailVerified", "createdAt", "updatedAt"
    ) VALUES (
      'cutover-user-2', 'Cutover User 2', 'cutover-2@example.test', true, NOW(), NOW()
    );

    INSERT INTO workspace (id, "userId", "createdAt", "updatedAt") VALUES
      ('10000000-0000-4000-8000-000000000002', 'cutover-user-2', NOW(), NOW());

    INSERT INTO orchestrator (
      id, "userId", "workspaceId", name, "createdAt", "updatedAt"
    ) VALUES
      (
        '30000000-0000-4000-8000-000000000001',
        'cutover-user-2',
        '10000000-0000-4000-8000-000000000002',
        'First Bot',
        NOW(),
        NOW()
      );

    INSERT INTO coworker (
      id, slug, name, "vendorId", "sokoBotId", capabilities, "createdAt", "updatedAt"
    ) VALUES
      (
        'shadow-a',
        'shadow-a',
        'Shadow A',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000002',
        ARRAY['chat', 'tasks'],
        NOW(),
        NOW()
      ),
      (
        'shadow-b',
        'shadow-b',
        'Shadow B',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        ARRAY['chat', 'tasks'],
        NOW(),
        NOW()
      );

    INSERT INTO coworker_assignment (
      id, "coworkerId", "userId", "createdAt", "updatedAt"
    ) VALUES (
      'cutover-assignment', 'shadow-a', 'cutover-user', NOW(), NOW()
    );

    INSERT INTO coworker_workspace_access (
      id, "coworkerId", "workspaceId", status, "createdAt", "updatedAt"
    ) VALUES (
      '45000000-0000-4000-8000-000000000001',
      'shadow-a',
      '10000000-0000-4000-8000-000000000001',
      'PENDING',
      NOW(),
      NOW()
    );

    INSERT INTO notification (
      id,
      "userId",
      kind,
      "referenceId",
      "eventId",
      "messageKey",
      "messageParams",
      metadata,
      "createdAt"
    ) VALUES (
      'cutover-access-notification',
      'cutover-user',
      'SYSTEM',
      '45000000-0000-4000-8000-000000000001',
      '45000000-0000-4000-8000-000000000001',
      'notifications.coworkerAccess.pending',
      '{}',
      '{"coworkerId":"shadow-a"}',
      NOW()
    );

    INSERT INTO chat_room (
      id, name, kind, "directKey", "createdByUserId", "createdAt", "updatedAt"
    ) VALUES
      (
        '40000000-0000-4000-8000-000000000001',
        'Legacy group direct',
        'direct',
        'direct:v2:coworker:shadow-a:coworker:shadow-b:user:cutover-user',
        'cutover-user',
        NOW(),
        NOW()
      ),
      (
        '40000000-0000-4000-8000-000000000003',
        'Legacy one-to-one direct',
        'direct',
        'coworker:cutover-user:shadow-a',
        'cutover-user',
        NOW(),
        NOW()
      );

    INSERT INTO chat_room_coworker_member (
      id, "roomId", "coworkerId", "createdAt"
    ) VALUES
      (
        '41000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        'shadow-a',
        '2026-01-01T10:00:00Z'
      ),
      (
        '41000000-0000-4000-8000-000000000002',
        '40000000-0000-4000-8000-000000000001',
        'shadow-b',
        '2026-01-01T11:00:00Z'
      );

    INSERT INTO chat_room_message (
      id, "roomId", "senderCoworkerId", content, "createdAt"
    ) VALUES (
      '42000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      'shadow-a',
      'Legacy PA message',
      NOW()
    );

    INSERT INTO chat_room_mention (
      id, "messageId", "coworkerId", status, "createdAt", "updatedAt"
    ) VALUES (
      '43000000-0000-4000-8000-000000000001',
      '42000000-0000-4000-8000-000000000001',
      'shadow-b',
      'responded',
      NOW(),
      NOW()
    );

    INSERT INTO task (
      id,
      "ownerId",
      "workspaceId",
      name,
      status,
      "assigneeId",
      "creatorCoworkerId",
      "createdAt",
      "updatedAt"
    ) VALUES (
      'cutover-task',
      'cutover-user',
      '10000000-0000-4000-8000-000000000001',
      'Legacy PA task',
      'READY',
      'shadow-a',
      'shadow-a',
      NOW(),
      NOW()
    );

    INSERT INTO "taskEvent" (
      id, "taskId", comment, "coworkerId", "createdAt", "updatedAt"
    ) VALUES (
      'cutover-event', 'cutover-task', 'Legacy event', 'shadow-a', NOW(), NOW()
    );

    INSERT INTO task_file (
      id,
      "taskId",
      name,
      "fileUrl",
      "uploadedByCoworkerId",
      "createdAt",
      "updatedAt"
    ) VALUES (
      'cutover-file',
      'cutover-task',
      'legacy.txt',
      'https://example.test/legacy.txt',
      'shadow-a',
      NOW(),
      NOW()
    );

    INSERT INTO coworker_api_key (
      id,
      name,
      "keyHash",
      "keyStart",
      "coworkerId",
      "createdAt",
      "updatedAt"
    ) VALUES (
      'cutover-key',
      'Legacy key',
      'cutover-key-hash',
      'coworker_abcd',
      'shadow-a',
      NOW(),
      NOW()
    );

    INSERT INTO "Transaction" (
      id, amount, "userId", "createdAt", "updatedAt"
    ) VALUES (
      'cutover-usage-transaction', -100, 'cutover-user', NOW(), NOW()
    );

    INSERT INTO coworker_usage (
      id,
      "idempotencyKey",
      "referenceId",
      "coworkerId",
      "userId",
      cents,
      "transactionId",
      "createdAt",
      "updatedAt"
    ) VALUES (
      '44000000-0000-4000-8000-000000000001',
      'legacy-usage',
      'legacy-reference',
      'shadow-a',
      'cutover-user',
      100,
      'cutover-usage-transaction',
      NOW(),
      NOW()
    );
  `);
}

async function applyCutoverMigration(connectionUrl: string): Promise<void> {
  await execFileAsync(
    process.env.PSQL_BIN ?? "psql",
    [
      connectionUrl,
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      path.join(migrationsDirectory, CUTOVER_MIGRATION, "migration.sql"),
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );
}

describeDatabase("PA orchestrator cutover migration against PostgreSQL", () => {
  it("preserves every persisted PA identity reference and canonicalizes group directs", {
    timeout: 120_000,
  }, async () => {
    await withPreCutoverDatabase(async (client, connectionUrl) => {
      await insertPreCutoverFixture(client);
      await applyCutoverMigration(connectionUrl);

      const result = await client.query<{
        apiKeyOrchestratorId: string | null;
        apiKeyOwnerCount: string;
        assignmentCount: string;
        coworkerCount: string;
        coworkerUsageCount: string;
        creatorOrchestratorId: string | null;
        directKey: string;
        eventOrchestratorId: string | null;
        fileOrchestratorId: string | null;
        historyOrchestratorId: string | null;
        legacyDirectKey: string;
        membershipOrchestratorIds: string;
        mentionOrchestratorId: string | null;
        notificationCount: string;
        senderOrchestratorId: string | null;
        taskOrchestratorId: string | null;
        usageOrchestratorId: string | null;
        workspaceAccessCount: string;
      }>(`
          SELECT
            (SELECT COUNT(*) FROM coworker WHERE "sokoBotId" IS NOT NULL)::text AS "coworkerCount",
            (SELECT "directKey" FROM chat_room WHERE id = '40000000-0000-4000-8000-000000000001') AS "directKey",
            (SELECT "directKey" FROM chat_room WHERE id = '40000000-0000-4000-8000-000000000003') AS "legacyDirectKey",
            (SELECT string_agg("orchestratorId"::text, ',' ORDER BY "orchestratorId") FROM chat_room_orchestrator_member WHERE "roomId" = '40000000-0000-4000-8000-000000000001') AS "membershipOrchestratorIds",
            (SELECT "senderOrchestratorId"::text FROM chat_room_message WHERE id = '42000000-0000-4000-8000-000000000001') AS "senderOrchestratorId",
            (SELECT "orchestratorId"::text FROM chat_room_mention WHERE id = '43000000-0000-4000-8000-000000000001') AS "mentionOrchestratorId",
            (SELECT "assigneeOrchestratorId"::text FROM task WHERE id = 'cutover-task') AS "taskOrchestratorId",
            (SELECT "creatorOrchestratorId"::text FROM task WHERE id = 'cutover-task') AS "creatorOrchestratorId",
            (SELECT "orchestratorId"::text FROM "taskEvent" WHERE id = 'cutover-event') AS "eventOrchestratorId",
            (SELECT "uploadedByOrchestratorId"::text FROM task_file WHERE id = 'cutover-file') AS "fileOrchestratorId",
            (SELECT "orchestratorId"::text FROM history WHERE "entityId" = 'cutover-task') AS "historyOrchestratorId",
            (SELECT "orchestratorId"::text FROM coworker_api_key WHERE id = 'cutover-key') AS "apiKeyOrchestratorId",
            (SELECT (("coworkerId" IS NOT NULL)::int + ("orchestratorId" IS NOT NULL)::int)::text FROM coworker_api_key WHERE id = 'cutover-key') AS "apiKeyOwnerCount",
            (SELECT COUNT(*) FROM coworker_usage WHERE "transactionId" = 'cutover-usage-transaction')::text AS "coworkerUsageCount",
            (SELECT "orchestratorId"::text FROM orchestrator_usage WHERE "transactionId" = 'cutover-usage-transaction') AS "usageOrchestratorId",
            (SELECT COUNT(*) FROM coworker_assignment WHERE "coworkerId" = 'shadow-a')::text AS "assignmentCount",
            (SELECT COUNT(*) FROM coworker_workspace_access WHERE "coworkerId" = 'shadow-a')::text AS "workspaceAccessCount",
            (SELECT COUNT(*) FROM notification WHERE id = 'cutover-access-notification')::text AS "notificationCount"
        `);

      expect(result.rows[0]).toEqual({
        coworkerCount: "0",
        directKey:
          "direct:v2:orchestrator:30000000-0000-4000-8000-000000000001:orchestrator:30000000-0000-4000-8000-000000000002:user:cutover-user",
        legacyDirectKey:
          "orchestrator:cutover-user:30000000-0000-4000-8000-000000000002",
        membershipOrchestratorIds:
          "30000000-0000-4000-8000-000000000001,30000000-0000-4000-8000-000000000002",
        senderOrchestratorId: "30000000-0000-4000-8000-000000000002",
        mentionOrchestratorId: "30000000-0000-4000-8000-000000000001",
        taskOrchestratorId: "30000000-0000-4000-8000-000000000002",
        creatorOrchestratorId: "30000000-0000-4000-8000-000000000002",
        eventOrchestratorId: "30000000-0000-4000-8000-000000000002",
        fileOrchestratorId: "30000000-0000-4000-8000-000000000002",
        historyOrchestratorId: "30000000-0000-4000-8000-000000000002",
        apiKeyOrchestratorId: "30000000-0000-4000-8000-000000000002",
        apiKeyOwnerCount: "1",
        coworkerUsageCount: "0",
        usageOrchestratorId: "30000000-0000-4000-8000-000000000002",
        assignmentCount: "0",
        workspaceAccessCount: "0",
        notificationCount: "0",
      });
    });
  });

  it("rolls back every cutover write when a remapped direct key collides", {
    timeout: 120_000,
  }, async () => {
    await withPreCutoverDatabase(async (client, connectionUrl) => {
      await insertPreCutoverFixture(client);
      await client.query(`
          DELETE FROM chat_room
          WHERE id = '40000000-0000-4000-8000-000000000003';

          INSERT INTO chat_room (
            id, name, kind, "directKey", "createdByUserId", "createdAt", "updatedAt"
          ) VALUES (
            '40000000-0000-4000-8000-000000000002',
            'Existing orchestrator direct',
            'direct',
            'orchestrator:cutover-user:30000000-0000-4000-8000-000000000002',
            'cutover-user',
            NOW(),
            NOW()
          );
          UPDATE chat_room
          SET "directKey" = 'coworker:cutover-user:shadow-a'
          WHERE id = '40000000-0000-4000-8000-000000000001';
        `);

      await expect(applyCutoverMigration(connectionUrl)).rejects.toThrow();

      const result = await client.query<{
        cutoverTable: string | null;
        fileCoworkerId: string | null;
        memberCount: string;
        notificationCount: string;
        senderCoworkerId: string | null;
        shadowCount: string;
      }>(`
          SELECT
            to_regclass('public.chat_room_orchestrator_member')::text AS "cutoverTable",
            (SELECT COUNT(*) FROM coworker WHERE "sokoBotId" IS NOT NULL)::text AS "shadowCount",
            (SELECT COUNT(*) FROM chat_room_coworker_member)::text AS "memberCount",
            (SELECT "senderCoworkerId" FROM chat_room_message WHERE id = '42000000-0000-4000-8000-000000000001') AS "senderCoworkerId",
            (SELECT "uploadedByCoworkerId" FROM task_file WHERE id = 'cutover-file') AS "fileCoworkerId",
            (SELECT COUNT(*) FROM notification WHERE id = 'cutover-access-notification')::text AS "notificationCount"
        `);

      expect(result.rows[0]).toEqual({
        cutoverTable: null,
        shadowCount: "2",
        memberCount: "2",
        senderCoworkerId: "shadow-a",
        fileCoworkerId: "shadow-a",
        notificationCount: "1",
      });
    });
  });
});
