import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_TAG_VOCABULARY_VERSION } from "@/helpers/task-tags";
import {
  classifyFixtureTaskTags,
  classifyPendingTaskTags,
} from "./task-tag-classification.service";

const publishTaskEventMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ably/publish", () => ({
  publishTaskEventData: publishTaskEventMock,
}));
const transactionMock = vi.hoisted(() => vi.fn());
const findFirstMock = vi.hoisted(() => vi.fn());
const loadCatalogMock = vi.hoisted(() => vi.fn());
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
  default: {
    $transaction: transactionMock,
    workspaceLabel: { findMany: loadCatalogMock },
    task: {
      findFirst: findFirstMock,
      findMany: findManyMock,
      updateMany: updateManyMock,
    },
  },
}));
vi.mock("@/lib/evlog", () => ({
  createCoreLogger: () => ({ set: logSetMock, emit: logEmitMock }),
}));
const task = {
  id: "task-1",
  workspaceId: "workspace-1",
  ownerId: "owner-1",
  name: "Private task",
  description: "Private description",
  tagContentRevision: 4,
  tagClassificationAttempts: 0,
  tagClassificationState: "pending",
  tagClassificationLease: null,
  updatedAt: new Date("2026-01-02T03:04:05.000Z"),
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
afterEach(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  vi.resetAllMocks();
  availableMock.mockResolvedValue(true);
  loadCatalogMock.mockResolvedValue([]);
  findFirstMock.mockResolvedValue(null);
  findManyMock.mockResolvedValue([]).mockResolvedValueOnce([task]);
  updateManyMock.mockResolvedValue({ count: 1 });
  classifyMock.mockResolvedValue({
    ok: true,
    workspaceSuggestions: [],
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
          status: { not: "GRANT_PENDING" },
          archivedAt: null,
          tagClassificationAvailableAt: { lte: expect.any(Date) },
          OR: [
            {
              tagClassificationState: "pending",
              tagClassificationAttempts: 0,
              tagClassificationLease: null,
            },
            {
              tagClassificationState: "pending",
              tagClassificationAttempts: { lt: 2 },
              tagClassificationLease: "queued:retry",
            },
            {
              tagClassificationState: "running",
              tagClassificationLease: { startsWith: "queued:" },
            },
          ],
        },
        take: 50,
        select: {
          id: true,
          workspaceId: true,
          ownerId: true,
          name: true,
          description: true,
          tagContentRevision: true,
          tagClassificationAttempts: true,
          tagClassificationState: true,
          tagClassificationLease: true,
          updatedAt: true,
        },
      }),
    );
    const claim = updateManyMock.mock.calls[0]![0];
    expect(claim).toMatchObject({
      where: {
        status: { not: "GRANT_PENDING" },
        id: task.id,
        updatedAt: task.updatedAt,
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
        tagClassificationLease: expect.stringMatching(/^queued:/),
        tagClassificationAttempts: { increment: 1 },
        tagClassificationAvailableAt: expect.any(Date),
        updatedAt: task.updatedAt,
      },
    });
    expect(updateManyMock.mock.calls[1]![0]).toEqual({
      where: {
        status: { not: "GRANT_PENDING" },
        id: task.id,
        updatedAt: task.updatedAt,
        workspaceId: task.workspaceId,
        archivedAt: null,
        tagContentRevision: 4,
        tagClassificationLease: claim.data.tagClassificationLease,
      },
      data: {
        automaticTags: ["research"],
        tagClassificationState: "complete",
        tagClassificationLease: null,
        tagVocabularyVersion: TASK_TAG_VOCABULARY_VERSION,
        updatedAt: task.updatedAt,
      },
    });
    expect(classifyMock).toHaveBeenCalledExactlyOnceWith(
      task.name,
      task.description,
      context.abortSignal,
      [],
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
  it("keeps a newer human edit timestamp when it completes the same revision", async () => {
    const manualEdit = new Date(task.updatedAt.getTime() + 5000);
    updateManyMock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    findFirstMock.mockResolvedValueOnce({ updatedAt: manualEdit });
    await classifyPendingTaskTags(context);
    expect(updateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          updatedAt: manualEdit,
          tagContentRevision: task.tagContentRevision,
        }),
        data: expect.objectContaining({
          updatedAt: manualEdit,
          tagClassificationState: "complete",
        }),
      }),
    );
  });

  it.each([true, false])(
    "publishes only newly persisted suggestions, even if notification delivery fails (%s)",
    async (eligible) => {
      const candidate = {
        id: "01960001-0001-7001-8001-000000000043",
        displayName: "Treasury",
        vocabularyVersion: 1,
        color: null,
        description: null,
      };
      loadCatalogMock.mockResolvedValueOnce([candidate]);
      classifyMock.mockResolvedValueOnce({
        ok: true,
        tags: [],
        workspaceSuggestions: [{ ...candidate, autoApply: false }],
      });
      publishTaskEventMock.mockRejectedValueOnce(
        new Error("notification unavailable"),
      );
      transactionMock.mockImplementationOnce(async (fn) =>
        fn({
          task: { updateMany: updateManyMock, findFirst: findFirstMock },
          $queryRaw: async () => (eligible ? [candidate] : []),
          taskWorkspaceTagDecision: { createMany: async () => ({ count: 1 }) },
        }),
      );
      await classifyPendingTaskTags(context);
      expect(classifyMock).toHaveBeenCalledExactlyOnceWith(
        task.name,
        task.description,
        context.abortSignal,
        [expect.objectContaining(candidate)],
      );
      expect(logSetMock).toHaveBeenCalledWith(
        expect.objectContaining({ completed: 1, failed: 0 }),
      );
      if (eligible) {
        expect(publishTaskEventMock).toHaveBeenCalledExactlyOnceWith({
          userId: task.ownerId,
          taskId: task.id,
          eventType: "task_event",
        });
        expect(logSetMock).toHaveBeenCalledWith({
          tagNotification: "publish_failed",
        });
      } else {
        expect(publishTaskEventMock).not.toHaveBeenCalled();
      }
    },
  );

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
          status: { not: "GRANT_PENDING" },
          id: task.id,
          updatedAt: task.updatedAt,
          workspaceId: task.workspaceId,
          archivedAt: null,
          tagContentRevision: 4,
          tagClassificationLease:
            updateManyMock.mock.calls[0]![0].data.tagClassificationLease,
        },
        data: {
          tagClassificationState: attempts === 0 ? "pending" : "failed",
          tagClassificationLease: attempts === 0 ? "queued:retry" : null,
          tagClassificationAvailableAt: expect.any(Date),
          updatedAt: task.updatedAt,
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
          tagClassificationLease: "queued:expired-lease",
        },
      ]);
    await classifyPendingTaskTags(context);
    expect(updateManyMock).toHaveBeenCalledExactlyOnceWith({
      where: {
        status: { not: "GRANT_PENDING" },
        id: task.id,
        updatedAt: task.updatedAt,
        workspaceId: task.workspaceId,
        archivedAt: null,
        tagContentRevision: 4,
        tagClassificationState: "running",
        tagClassificationAttempts: 2,
        tagClassificationLease: "queued:expired-lease",
        tagClassificationAvailableAt: { lte: expect.any(Date) },
      },
      data: {
        tagClassificationState: "failed",
        tagClassificationLease: null,
        updatedAt: task.updatedAt,
      },
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
          tagClassificationLease: "queued:expired-lease",
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
    expect(findManyMock).toHaveBeenCalledTimes(1);
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

describe("task tag queue bounds", () => {
  it("leaves historical Tasks untouched when the queue is empty", async () => {
    findManyMock
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { ...task, tagClassificationState: "unclassified" },
      ]);
    await classifyPendingTaskTags(context);
    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(classifyMock).not.toHaveBeenCalled();
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("commits partial progress and defers the rest at the sync deadline", async () => {
    findManyMock.mockReset().mockResolvedValueOnce(
      Array.from({ length: 10 }, (_, index) => ({
        ...task,
        id: `queued-${index}`,
      })),
    );
    let msRemaining = 60_000;
    classifyMock.mockImplementation(() => {
      msRemaining -= 20_000;
      return Promise.resolve({
        ok: true,
        workspaceSuggestions: [],
        tags: [],
        usage: { inputTokens: 1, outputTokens: 1 },
        costUsd: "0",
      });
    });
    await classifyPendingTaskTags({
      ...context,
      msRemaining: () => msRemaining,
    });
    expect(classifyMock).toHaveBeenCalledTimes(3);
    // Exactly one claim and one persist per attempted row: nothing is left leased.
    expect(updateManyMock.mock.calls.map(([call]) => call.where.id)).toEqual([
      "queued-0",
      "queued-0",
      "queued-1",
      "queued-1",
      "queued-2",
      "queued-2",
    ]);
    expect(logSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        selected: 10,
        queued: 10,
        completed: 3,
        deferred: 7,
        stopReason: "deadline",
      }),
    );
  });

  it("stops queued work at the tick budget so the lock is released early", async () => {
    vi.useFakeTimers();
    findManyMock
      .mockReset()
      .mockResolvedValue([])
      .mockResolvedValueOnce(
        Array.from({ length: 50 }, (_, index) => ({
          ...task,
          id: `queued-${index}`,
        })),
      );
    // A provider at its 12s request timeout would otherwise run 50 queued rows
    // for 600s, far past the deadline and into the next scheduled tick.
    classifyMock.mockImplementation(() => {
      vi.advanceTimersByTime(12_000);
      return Promise.resolve({
        ok: true,
        workspaceSuggestions: [],
        tags: [],
        usage: { inputTokens: 1, outputTokens: 1 },
        costUsd: "0",
      });
    });
    await classifyPendingTaskTags(context);
    expect(classifyMock).toHaveBeenCalledTimes(10);
    expect(logSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        selected: 50,
        queued: 50,
        completed: 10,
        deferred: 40,
        stopReason: "tick_budget",
      }),
    );
  });

  it("stops the tick at the bounded per-tick reported spend ceiling", async () => {
    findManyMock.mockReset().mockResolvedValueOnce(
      Array.from({ length: 10 }, (_, index) => ({
        ...task,
        id: `queued-${index}`,
      })),
    );
    classifyMock.mockResolvedValue({
      ok: true,
      workspaceSuggestions: [],
      tags: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: "0.03",
    });
    await classifyPendingTaskTags(context);
    expect(classifyMock).toHaveBeenCalledTimes(2);
    expect(logSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attempted: 2,
        completed: 2,
        costUsd: 0.06,
        deferred: 8,
        stopReason: "spend_ceiling",
      }),
    );
  });

  it("counts known costs and retains the missing-cost count for partially billed batches", async () => {
    classifyMock.mockResolvedValueOnce({
      ok: true,
      tags: [],
      workspaceSuggestions: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      costUsd: "0.02",
      costIncomplete: true,
    });
    await classifyPendingTaskTags(context);
    expect(logSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ costIncomplete: true, costUsd: "0.02" }),
    );
    expect(logSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ unreportedCost: 1, costUsd: 0.02 }),
    );
  });

  it("reports missing provider billing without pretending failed attempts were free", async () => {
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
});
