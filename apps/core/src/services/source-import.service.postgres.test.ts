import { randomUUID } from "node:crypto";
import {
  type Prisma,
  TaskFileOrigin,
  TaskFileStatus,
} from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";

import type { TaskFileClient } from "./source-import.service";
import { sourceImportService } from "./source-import.service";

/**
 * Real Postgres proof that a statement failure inside
 * `enqueueTaskOutputsFromMarkdown` must leave the serializable transaction,
 * not be swallowed. Swallowing aborts the Postgres transaction and the next
 * statement (the same `taskEvent.findUnique` the events POST runs) fails with
 * SQLSTATE 25P02, which `serializableTransaction` does not retry.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true \
 *     DATABASE_URL=postgres://… \
 *     pnpm --filter core exec vitest run \
 *       src/services/source-import.service.postgres.test.ts
 */
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const userId = randomUUID();
const workspaceId = randomUUID();

const FILE_MARKDOWN = "[file](https://example.com/result.pdf)";

/**
 * First attempt: abort the same connection enqueue uses, the way a
 * serialization failure does. Later attempts run the real upsert so the
 * retry can commit.
 */
function taskFileClient(
  tx: Prisma.TransactionClient,
  attempt: number,
): TaskFileClient {
  return {
    taskFile: {
      findFirst: (args) => tx.taskFile.findFirst(args),
      upsert: async (args) => {
        if (attempt === 1) {
          await tx.$executeRawUnsafe(
            "DO $$ BEGIN RAISE SQLSTATE '40001' USING MESSAGE = 'could not serialize access due to concurrent update'; END $$;",
          );
        }
        return tx.taskFile.upsert({
          where: args.where,
          update: {},
          create: {
            taskId: args.create.taskId,
            name: args.create.name,
            sourceUrl: args.create.sourceUrl,
            fileUrl: null,
            status: TaskFileStatus.PENDING,
            origin: TaskFileOrigin.TASK_OUTPUT,
          },
        });
      },
    },
  };
}

describe.skipIf(!enabled)(
  "enqueueTaskOutputsFromMarkdown inside a serializable transaction",
  () => {
    let taskId: string;
    let eventId: string;

    beforeAll(async () => {
      await prisma.user.create({
        data: {
          id: userId,
          name: "Source import tx fixture",
          email: `${userId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          workspace: { create: { id: workspaceId } },
        },
      });
      const task = await prisma.task.create({
        data: {
          ownerId: userId,
          creatorUserId: userId,
          workspaceId,
          name: "Source import tx task",
        },
      });
      taskId = task.id;
      const event = await prisma.taskEvent.create({
        data: { taskId, comment: FILE_MARKDOWN },
      });
      eventId = event.id;
    });

    afterAll(async () => {
      await prisma.task.deleteMany({ where: { id: taskId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });

    it("retries a swallowed-path serialization failure instead of failing on 25P02", async () => {
      let attempts = 0;

      const event = await serializableTransaction(async (tx) => {
        attempts += 1;
        await sourceImportService.enqueueTaskOutputsFromMarkdown(
          taskId,
          FILE_MARKDOWN,
          taskFileClient(tx, attempts),
        );
        return tx.taskEvent.findUnique({ where: { id: eventId } });
      }, "Task changed by a concurrent request. Please retry.");

      expect(attempts).toBeGreaterThan(1);
      expect(event?.id).toBe(eventId);
      const file = await prisma.taskFile.findFirst({
        where: { taskId, sourceUrl: "https://example.com/result.pdf" },
      });
      expect(file?.status).toBe("PENDING");
      expect(file?.origin).toBe("TASK_OUTPUT");
    });
  },
);
