import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { classifyFixtureTaskTags } from "./task-tag-classification.service";

const classify = vi.hoisted(() => vi.fn());
vi.mock("@/clients/task-tag-classifier", () => ({
  classifyTaskTags: classify,
  taskTagProviderAvailable: async () => true,
  JEV_TASK_TAG_MODEL: "typesafe-ai/jev",
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

it.skipIf(!enabled)(
  "only evaluates queued creates, edits, and identifiable retries",
  async () => {
    const user = await prisma.user.create({
      data: {
        name: "Task tag queue fixture",
        email: `${randomUUID()}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    const taskId = randomUUID();
    const scope = { taskId, ownerId: user.id };
    const due = new Date(0);
    const context = {
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      msRemaining: () => 60_000,
      shouldContinue: () => true,
    };
    const run = () => classifyFixtureTaskTags(context, scope);
    const snapshot = () =>
      prisma.task.findUniqueOrThrow({
        where: { id: taskId },
        select: {
          updatedAt: true,
          automaticTags: true,
          manualTags: true,
          rejectedTags: true,
          tagContentRevision: true,
          tagVocabularyVersion: true,
          tagClassificationState: true,
          tagClassificationAttempts: true,
          tagClassificationLease: true,
          tagClassificationAvailableAt: true,
        },
      });
    try {
      const workspace = await prisma.workspace.create({
        data: { userId: user.id },
        select: { id: true },
      });
      await prisma.task.create({
        data: {
          id: taskId,
          name: "SYNTHETIC Task",
          tagClassificationAvailableAt: due,
          ownerId: user.id,
          workspaceId: workspace.id,
          manualTags: ["design"],
          rejectedTags: ["sales"],
        },
        select: { id: true },
      });
      classify.mockResolvedValue({
        ok: true,
        tags: ["research"],
        workspaceSuggestions: [],
      });
      await run();
      expect(classify).toHaveBeenCalledTimes(1);
      expect((await snapshot()).automaticTags).toEqual(["research"]);

      const historicalRows = [
        { state: "unclassified", attempts: 0, lease: null },
        { state: "pending", attempts: 1, lease: null },
        { state: "running", attempts: 1, lease: randomUUID() },
        { state: "running", attempts: 1, lease: `historical:${randomUUID()}` },
        { state: "running", attempts: 2, lease: `historical:${randomUUID()}` },
      ];
      for (const { state, attempts, lease } of historicalRows) {
        await prisma.task.updateMany({
          where: { id: taskId },
          data: {
            automaticTags: ["writing"],
            tagClassificationState: state,
            tagClassificationAttempts: attempts,
            tagClassificationLease: lease,
            tagClassificationAvailableAt: due,
          },
        });
        const before = await snapshot();
        await run();
        expect(await snapshot()).toEqual(before);
        expect(classify).toHaveBeenCalledTimes(1);
      }

      // A real content edit uses the database trigger to queue a fresh revision.
      await prisma.task.updateMany({
        where: { id: taskId },
        data: { name: "SYNTHETIC edited Task" },
      });
      // The last automatic tags stay until the new revision succeeds.
      expect(await snapshot()).toMatchObject({
        automaticTags: ["writing"],
        tagClassificationState: "pending",
        tagClassificationAttempts: 0,
        tagClassificationLease: null,
      });
      // The real cron fires later. Make this revision due independently of clock precision.
      await prisma.task.updateMany({
        where: { id: taskId },
        data: { tagClassificationAvailableAt: due },
      });
      classify.mockRejectedValueOnce(new Error("provider unavailable"));
      await run();
      expect(classify).toHaveBeenCalledTimes(2);
      expect(await snapshot()).toMatchObject({
        automaticTags: ["writing"],
        tagClassificationState: "pending",
        tagClassificationAttempts: 1,
        tagClassificationLease: "queued:retry",
      });
      await prisma.task.updateMany({
        where: { id: taskId },
        data: { tagClassificationAvailableAt: due },
      });
      await run();
      expect(classify).toHaveBeenCalledTimes(3);
      expect(await snapshot()).toMatchObject({
        tagClassificationState: "complete",
        automaticTags: ["research"],
        manualTags: ["design"],
        rejectedTags: ["sales"],
      });

      await prisma.task.updateMany({
        where: { id: taskId },
        data: {
          tagClassificationState: "running",
          tagClassificationAttempts: 1,
          tagClassificationLease: `queued:${randomUUID()}`,
          tagClassificationAvailableAt: due,
        },
      });
      await run();
      expect(classify).toHaveBeenCalledTimes(4);
      expect((await snapshot()).tagClassificationState).toBe("complete");
    } finally {
      await prisma.task.deleteMany({ where: { id: taskId } });
      await prisma.workspace.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({
        where: { id: user.id },
        select: { id: true },
      });
    }
  },
);
