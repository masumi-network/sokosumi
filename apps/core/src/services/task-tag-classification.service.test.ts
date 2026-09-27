import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyFixtureTaskTags,
  classifyPendingTaskTags,
} from "./task-tag-classification.service";

const {
  availableMock,
  classifyMock,
  findManyMock,
  countMock,
  updateManyMock,
  logSetMock,
  logEmitMock,
} = vi.hoisted(() => ({
  availableMock: vi.fn(),
  classifyMock: vi.fn(),
  findManyMock: vi.fn(),
  countMock: vi.fn(),
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
  default: {
    task: {
      findMany: findManyMock,
      updateMany: updateManyMock,
      count: countMock,
    },
  },
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
  tagClassificationState: "pending",
  tagClassificationLease: null,
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
  findManyMock.mockResolvedValue([]).mockResolvedValueOnce([task]);
  countMock.mockResolvedValue(0);
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
        tagClassificationState: "pending",
        tagClassificationLease: null,
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
    expect(logEmitMock).toHaveBeenCalledTimes(2);
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
      findManyMock
        .mockReset()
        .mockResolvedValue([])
        .mockResolvedValueOnce([
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
    expect(logEmitMock).toHaveBeenCalledTimes(2);
    expect(updateManyMock.mock.calls[1]![0].data.tagClassificationState).toBe(
      "pending",
    );
  });
  it("recovers an expired final lease within the batch without another evaluation", async () => {
    findManyMock
      .mockReset()
      .mockResolvedValue([])
      .mockResolvedValueOnce([
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
    findManyMock
      .mockReset()
      .mockResolvedValue([])
      .mockResolvedValueOnce([
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
    findManyMock
      .mockReset()
      .mockResolvedValue([])
      .mockResolvedValueOnce([task, { ...task, id: "task-2" }]);
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
    findManyMock
      .mockReset()
      .mockResolvedValue([])
      .mockResolvedValueOnce([task, { ...task, id: "task-2" }]);
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
      findManyMock
        .mockReset()
        .mockResolvedValue([])
        .mockResolvedValueOnce([task, { ...task, id: "task-2" }]);
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

describe("classifyFixtureTaskTags", () => {
  it("restricts selection, claim, and persistence to the identified synthetic draft owner", async () => {
    await classifyFixtureTaskTags(context, {
      taskId: task.id,
      ownerId: "fixture-owner",
    });
    const scope = {
      id: task.id,
      ownerId: "fixture-owner",
      name: { startsWith: "SYNTHETIC " },
      status: "DRAFT",
    };
    expect(findManyMock.mock.calls[0]![0].where).toMatchObject(scope);
    expect(updateManyMock).toHaveBeenCalledTimes(2);
    for (const [call] of updateManyMock.mock.calls) {
      expect(call.where).toMatchObject(scope);
      expect(call.where).toMatchObject({
        workspaceId: task.workspaceId,
        tagContentRevision: 4,
      });
    }
    expect(classifyMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { taskId: "", ownerId: "fixture-owner" },
    { taskId: "task-1", ownerId: "" },
  ])("does nothing for incomplete scope %j", async (scope) => {
    await classifyFixtureTaskTags(context, scope);
    expect(availableMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
    expect(classifyMock).not.toHaveBeenCalled();
  });

  it("does nothing when a caller omits the required scope at runtime", async () => {
    await Reflect.apply(classifyFixtureTaskTags, undefined, [
      context,
      undefined,
    ]);
    expect(availableMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
    expect(classifyMock).not.toHaveBeenCalled();
  });

  it("does not fall back to the queue when the fixture does not match", async () => {
    findManyMock.mockReset().mockResolvedValue([]).mockResolvedValueOnce([]);
    await classifyFixtureTaskTags(context, {
      taskId: task.id,
      ownerId: "fixture-owner",
    });
    expect(findManyMock).toHaveBeenCalledTimes(2);
    for (const [query] of findManyMock.mock.calls) {
      expect(query.where).toMatchObject({
        id: task.id,
        ownerId: "fixture-owner",
      });
    }
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(classifyMock).not.toHaveBeenCalled();
  });
});

describe("historical tag backfill", () => {
  const historical = {
    ...task,
    id: "old-task",
    tagClassificationState: "unclassified",
  };

  it("fills spare slots after queued tasks and claims the exact historical revision", async () => {
    findManyMock
      .mockReset()
      .mockResolvedValueOnce([task])
      .mockResolvedValueOnce([historical]);
    await classifyPendingTaskTags(context);
    expect(findManyMock.mock.calls[1]![0]).toEqual({
      where: {
        archivedAt: null,
        tagClassificationState: "unclassified",
        tagClassificationAttempts: { lt: 2 },
        tagClassificationAvailableAt: { lte: expect.any(Date) },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 9,
    });
    expect(updateManyMock.mock.calls[0]![0].where.id).toBe(task.id);
    expect(updateManyMock.mock.calls[2]![0].where).toMatchObject({
      id: historical.id,
      workspaceId: historical.workspaceId,
      tagContentRevision: 4,
      tagClassificationState: "unclassified",
      tagClassificationLease: null,
      tagClassificationAttempts: 0,
    });
    expect(logSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        selected: 2,
        queued: 1,
        historical: 1,
        completed: 2,
        failed: 0,
        stale: 0,
        remainingHistorical: 0,
        usage: { inputTokens: 24, outputTokens: 16 },
        costUsd: 0.00024,
      }),
    );
  });

  it("never selects history when ten queued tasks consume the batch", async () => {
    findManyMock.mockReset().mockResolvedValueOnce(
      Array.from({ length: 10 }, (_, index) => ({
        ...task,
        id: `queued-${index}`,
      })),
    );
    await classifyPendingTaskTags(context);
    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(classifyMock).toHaveBeenCalledTimes(10);
  });

  it("resumes remaining history next tick without reclassifying complete empty results", async () => {
    const remaining = [historical, { ...historical, id: "old-task-2" }];
    findManyMock.mockReset().mockImplementation(({ where }) => {
      if (where.tagClassificationState === "unclassified")
        return Promise.resolve(remaining.splice(0, 1));
      return Promise.resolve([]);
    });
    classifyMock.mockResolvedValue({
      ok: true,
      tags: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: "0",
    });
    await classifyPendingTaskTags(context);
    await classifyPendingTaskTags(context);
    await classifyPendingTaskTags(context);
    expect(classifyMock).toHaveBeenCalledTimes(2);
    expect(updateManyMock.mock.calls[1]![0].data).toMatchObject({
      automaticTags: [],
      tagClassificationState: "complete",
    });
    expect(updateManyMock.mock.calls[3]![0].where.id).toBe("old-task-2");
  });

  it("does not classify history when its revision/state/lease claim loses", async () => {
    findManyMock
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([historical]);
    updateManyMock.mockResolvedValue({ count: 0 });
    await classifyPendingTaskTags(context);
    expect(classifyMock).not.toHaveBeenCalled();
    expect(logSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ stale: 1, completed: 0 }),
    );
  });

  it("keeps historical fixture selection, writes and progress count exactly scoped", async () => {
    findManyMock
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([historical]);
    await classifyFixtureTaskTags(context, {
      taskId: historical.id,
      ownerId: "fixture-owner",
    });
    for (const [query] of [
      ...findManyMock.mock.calls,
      ...updateManyMock.mock.calls,
      ...countMock.mock.calls,
    ]) {
      expect(query.where).toMatchObject({
        id: historical.id,
        ownerId: "fixture-owner",
        name: { startsWith: "SYNTHETIC " },
        status: "DRAFT",
      });
    }
    expect(classifyMock).toHaveBeenCalledTimes(1);
  });
  it("reports missing provider billing without pretending failed attempts were free", async () => {
    findManyMock
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([historical]);
    classifyMock.mockRejectedValue(new Error("private provider details"));
    await classifyPendingTaskTags(context);
    expect(logSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attempted: 1,
        failed: 1,
        costUsd: 0,
        unreportedCost: 1,
      }),
    );
    expect(updateManyMock.mock.calls[1]![0].data).toMatchObject({
      tagClassificationState: "pending",
    });
    expect(updateManyMock.mock.calls[1]![0].data).not.toHaveProperty(
      "manualTags",
    );
    expect(updateManyMock.mock.calls[1]![0].data).not.toHaveProperty(
      "rejectedTags",
    );
  });

  it("counts a lost failure-release claim as stale", async () => {
    classifyMock.mockResolvedValue({ ok: false, reason: "http_503" });
    updateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await classifyPendingTaskTags(context);
    expect(logSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ stale: 1, failed: 0 }),
    );
  });

  it("keeps completed work successful if the progress count fails", async () => {
    countMock.mockRejectedValue(new Error("private database details"));
    await expect(classifyPendingTaskTags(context)).resolves.toBeUndefined();
    expect(logSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        completed: 1,
        progressError: "database_error",
      }),
    );
    expect(JSON.stringify(logSetMock.mock.calls)).not.toContain(
      "private database details",
    );
  });

  it("does not widen historical eligibility to completed, failed, archived or exhausted rows", async () => {
    await classifyPendingTaskTags(context);
    expect(findManyMock.mock.calls[1]![0].where).toEqual({
      archivedAt: null,
      tagClassificationState: "unclassified",
      tagClassificationAttempts: { lt: 2 },
      tagClassificationAvailableAt: { lte: expect.any(Date) },
    });
    expect(countMock.mock.calls[0]![0].where).toEqual(
      findManyMock.mock.calls[1]![0].where,
    );
  });
  it("prepares only a pristine exact fixture revision and never resets its completed rerun", async () => {
    const row = {
      ...historical,
      ownerId: "fixture-owner",
      name: "SYNTHETIC history",
      tagContentRevision: 1,
      tagClassificationState: "pending",
      automaticTags: [],
    };
    findManyMock.mockReset().mockImplementation(({ where }) => {
      const state = where.tagClassificationState;
      return Promise.resolve(
        (
          typeof state === "string"
            ? row.tagClassificationState === state
            : state.in.includes(row.tagClassificationState)
        )
          ? [{ ...row }]
          : [],
      );
    });
    updateManyMock.mockImplementation(({ where, data }) => {
      if (
        where.tagClassificationState &&
        where.tagClassificationState !== row.tagClassificationState
      )
        return Promise.resolve({ count: 0 });
      Object.assign(row, data);
      return Promise.resolve({ count: 1 });
    });
    await classifyFixtureTaskTags(context, {
      taskId: row.id,
      ownerId: row.ownerId,
      backfill: true,
    });
    expect(updateManyMock.mock.calls[0]![0]).toEqual({
      where: {
        id: row.id,
        ownerId: row.ownerId,
        name: { startsWith: "SYNTHETIC " },
        status: "DRAFT",
        archivedAt: null,
        tagClassificationState: "pending",
        tagContentRevision: 1,
        tagClassificationAttempts: 0,
        tagClassificationLease: null,
        automaticTags: { isEmpty: true },
      },
      data: { tagClassificationState: "unclassified" },
    });
    expect(logSetMock).toHaveBeenCalledWith({
      source: "historical",
      prepared: 1,
    });
    expect(row.tagClassificationState).toBe("complete");
    await classifyFixtureTaskTags(context, {
      taskId: row.id,
      ownerId: row.ownerId,
      backfill: true,
    });
    expect(logSetMock).toHaveBeenCalledWith({
      source: "historical",
      prepared: 0,
    });
    expect(classifyMock).toHaveBeenCalledTimes(1);
    expect(row.manualTags).toEqual(["design"]);
    expect(row.rejectedTags).toEqual(["research"]);
  });
});
