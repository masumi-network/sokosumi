import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyPendingTaskTags } from "./task-tag-classification.service";

const {
  availableMock,
  classifyMock,
  findManyMock,
  updateManyMock,
  logSetMock,
  logEmitMock,
} = vi.hoisted(() => ({
  availableMock: vi.fn(),
  classifyMock: vi.fn(),
  findManyMock: vi.fn(),
  updateManyMock: vi.fn(),
  logSetMock: vi.fn(),
  logEmitMock: vi.fn(),
}));
vi.mock("@/clients/task-tag-classifier", () => ({
  JEV_TASK_TAG_MODEL: "typesafe-ai/jev",
  taskTagProviderAvailable: availableMock,
  classifyTaskTags: classifyMock,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { task: { findMany: findManyMock, updateMany: updateManyMock } },
}));
vi.mock("@/lib/evlog", () => ({
  createCoreLogger: () => ({ set: logSetMock, emit: logEmitMock }),
}));
const task = {
  id: "task-1",
  workspaceId: "workspace-1",
  name: "Private task",
  description: "Private description",
  tagContentRevision: 4,
  tagClassificationAttempts: 0,
  automaticTags: ["writing"],
  manualTags: ["design"],
  rejectedTags: ["research"],
};
const context = {
  abortSignal: new AbortController().signal,
  deadlineMs: Date.now() + 60_000,
  msRemaining: () => 60_000,
  shouldContinue: () => true,
};
beforeEach(() => {
  vi.resetAllMocks();
  availableMock.mockResolvedValue(true);
  findManyMock.mockResolvedValue([task]);
  updateManyMock.mockResolvedValue({ count: 1 });
  classifyMock.mockResolvedValue({
    ok: true,
    tags: ["research"],
    usage: { inputTokens: 12, outputTokens: 8 },
    costUsd: "0.00012",
    generationId: "gen-test",
  });
});

describe("classifyPendingTaskTags", () => {
  it.each(["unavailable", "catalog error"])(
    "does no DB work or evaluation when provider is %s",
    async (failure) => {
      if (failure === "unavailable") availableMock.mockResolvedValue(false);
      else availableMock.mockRejectedValue(new Error("catalog error"));
      await classifyPendingTaskTags(context);
      expect(findManyMock).not.toHaveBeenCalled();
      expect(updateManyMock).not.toHaveBeenCalled();
      expect(classifyMock).not.toHaveBeenCalled();
    },
  );
  it("claims only due unarchived revisions under the retry limit, preserving human corrections", async () => {
    await classifyPendingTaskTags(context);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          tagClassificationState: { in: ["pending", "running"] },
          tagClassificationAvailableAt: { lte: expect.any(Date) },
          OR: [
            { tagClassificationAttempts: { lt: 2 } },
            {
              tagClassificationState: "running",
              tagClassificationAttempts: { gte: 2 },
            },
          ],
        },
        take: 10,
      }),
    );
    const claim = updateManyMock.mock.calls[0]![0];
    expect(claim).toMatchObject({
      where: {
        id: task.id,
        workspaceId: task.workspaceId,
        archivedAt: null,
        tagContentRevision: 4,
        tagClassificationState: { in: ["pending", "running"] },
        tagClassificationAvailableAt: { lte: expect.any(Date) },
        tagClassificationAttempts: 0,
      },
      data: {
        tagClassificationState: "running",
        tagClassificationLease: expect.any(String),
        tagClassificationAttempts: { increment: 1 },
        tagClassificationAvailableAt: expect.any(Date),
      },
    });
    expect(updateManyMock.mock.calls[1]![0]).toEqual({
      where: {
        id: task.id,
        workspaceId: task.workspaceId,
        archivedAt: null,
        tagContentRevision: 4,
        tagClassificationLease: claim.data.tagClassificationLease,
      },
      data: {
        automaticTags: ["research"],
        tagClassificationState: "complete",
        tagClassificationLease: null,
        tagVocabularyVersion: 1,
      },
    });
    expect(classifyMock).toHaveBeenCalledExactlyOnceWith(
      task.name,
      task.description,
      context.abortSignal,
    );
    expect(logSetMock).toHaveBeenCalledWith({
      usage: { inputTokens: 12, outputTokens: 8 },
      costUsd: "0.00012",
      generationId: "gen-test",
    });
    expect(JSON.stringify(logSetMock.mock.calls)).not.toContain(
      task.description,
    );
    expect(logEmitMock).toHaveBeenCalledTimes(1);
  });
  it("does not evaluate when another worker already owns the claim", async () => {
    updateManyMock.mockResolvedValue({ count: 0 });
    await classifyPendingTaskTags(context);
    expect(classifyMock).not.toHaveBeenCalled();
    expect(updateManyMock).toHaveBeenCalledTimes(1);
  });
  it("discards a successful result when content revision or lease has changed", async () => {
    updateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await classifyPendingTaskTags(context);
    expect(updateManyMock.mock.calls[1]![0].where).toMatchObject({
      tagContentRevision: 4,
      tagClassificationLease:
        updateManyMock.mock.calls[0]![0].data.tagClassificationLease,
    });
    expect(logSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "stale" }),
    );
    expect(updateManyMock).toHaveBeenCalledTimes(2);
  });
  it.each([0, 1])(
    "bounds failures after attempt %s and preserves existing tags",
    async (attempts) => {
      findManyMock.mockResolvedValue([
        { ...task, tagClassificationAttempts: attempts },
      ]);
      classifyMock.mockResolvedValue({ ok: false, reason: "http_503" });
      await classifyPendingTaskTags(context);
      expect(updateManyMock.mock.calls[1]![0]).toEqual({
        where: {
          id: task.id,
          workspaceId: task.workspaceId,
          archivedAt: null,
          tagContentRevision: 4,
          tagClassificationLease:
            updateManyMock.mock.calls[0]![0].data.tagClassificationLease,
        },
        data: {
          tagClassificationState: attempts === 0 ? "pending" : "failed",
          tagClassificationLease: null,
          tagClassificationAvailableAt: expect.any(Date),
        },
      });
      expect(classifyMock).toHaveBeenCalledTimes(1);
    },
  );
  it("releases failed evaluation leases without logging provider error contents", async () => {
    classifyMock.mockRejectedValue(
      new Error("private provider response and API key"),
    );
    await classifyPendingTaskTags(context);
    expect(logSetMock).toHaveBeenCalledWith({
      outcome: "failed",
      reason: "provider_or_validation_error",
    });
    expect(logEmitMock).toHaveBeenCalledTimes(1);
    expect(updateManyMock.mock.calls[1]![0].data.tagClassificationState).toBe(
      "pending",
    );
  });
  it("recovers an expired final lease within the batch without another evaluation", async () => {
    findManyMock.mockResolvedValue([
      {
        ...task,
        tagClassificationState: "running",
        tagClassificationAttempts: 2,
        tagClassificationLease: "expired-lease",
      },
    ]);
    await classifyPendingTaskTags(context);
    expect(findManyMock.mock.calls[0]![0].where).toMatchObject({
      OR: [
        { tagClassificationAttempts: { lt: 2 } },
        {
          tagClassificationState: "running",
          tagClassificationAttempts: { gte: 2 },
        },
      ],
    });
    expect(updateManyMock).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: task.id,
        workspaceId: task.workspaceId,
        archivedAt: null,
        tagContentRevision: 4,
        tagClassificationState: "running",
        tagClassificationAttempts: 2,
        tagClassificationLease: "expired-lease",
        tagClassificationAvailableAt: { lte: expect.any(Date) },
      },
      data: { tagClassificationState: "failed", tagClassificationLease: null },
    });
    expect(classifyMock).not.toHaveBeenCalled();
  });
  it("leaves a renewed final lease untouched when recovery loses its compare-and-set", async () => {
    findManyMock.mockResolvedValue([
      {
        ...task,
        tagClassificationState: "running",
        tagClassificationAttempts: 2,
        tagClassificationLease: "expired-lease",
      },
    ]);
    updateManyMock.mockResolvedValue({ count: 0 });
    await classifyPendingTaskTags(context);
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(classifyMock).not.toHaveBeenCalled();
    expect(logSetMock).toHaveBeenCalledWith({
      outcome: "stale",
      reason: "expired_final_lease",
    });
  });
  it("retains usage when persistence fails and processes the next task", async () => {
    findManyMock.mockResolvedValue([task, { ...task, id: "task-2" }]);
    updateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error("private database failure"));
    await classifyPendingTaskTags(context);
    expect(classifyMock).toHaveBeenCalledTimes(2);
    expect(logSetMock).toHaveBeenCalledWith({
      usage: { inputTokens: 12, outputTokens: 8 },
      costUsd: "0.00012",
      generationId: "gen-test",
    });
    expect(logSetMock).toHaveBeenCalledWith({
      outcome: "failed",
      reason: "database_error",
    });
    expect(updateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "task-2" }),
        data: expect.objectContaining({ tagClassificationState: "complete" }),
      }),
    );
  });
  it("continues after a provider exception", async () => {
    findManyMock.mockResolvedValue([task, { ...task, id: "task-2" }]);
    classifyMock.mockRejectedValueOnce(new Error("private provider response"));
    await classifyPendingTaskTags(context);
    expect(classifyMock).toHaveBeenCalledTimes(2);
    expect(updateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "task-2" }),
        data: expect.objectContaining({ tagClassificationState: "complete" }),
      }),
    );
  });
  it("logs usage for invalid answers without replacing existing tags", async () => {
    classifyMock.mockResolvedValue({
      ok: false,
      reason: "invalid_answers",
      usage: { inputTokens: 12, outputTokens: 8 },
      costUsd: "0.00012",
      generationId: "gen-test",
    });
    await classifyPendingTaskTags(context);
    expect(logSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: { inputTokens: 12, outputTokens: 8 },
        costUsd: "0.00012",
        generationId: "gen-test",
      }),
    );
    expect(updateManyMock.mock.calls[1]![0].data).not.toHaveProperty(
      "automaticTags",
    );
  });
  it.each(["claim", "release"])(
    "continues after a per-task %s database failure",
    async (stage) => {
      findManyMock.mockResolvedValue([task, { ...task, id: "task-2" }]);
      if (stage === "release") {
        updateManyMock.mockResolvedValueOnce({ count: 1 });
        classifyMock.mockResolvedValueOnce({ ok: false, reason: "http_503" });
      }
      updateManyMock.mockRejectedValueOnce(
        new Error("private database failure"),
      );
      await expect(classifyPendingTaskTags(context)).resolves.toBeUndefined();
      expect(updateManyMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "task-2" }),
          data: expect.objectContaining({ tagClassificationState: "complete" }),
        }),
      );
      expect(JSON.stringify(logSetMock.mock.calls)).not.toContain(
        "private database failure",
      );
    },
  );
  it.each([
    { shouldContinue: () => false, msRemaining: () => 60_000 },
    { shouldContinue: () => true, msRemaining: () => 14_999 },
  ])("does not claim new work past the sync budget", async (budget) => {
    await classifyPendingTaskTags({ ...context, ...budget });
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(classifyMock).not.toHaveBeenCalled();
  });
});
