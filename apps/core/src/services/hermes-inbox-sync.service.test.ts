import * as Sentry from "@sentry/node";
import { v5 as uuidv5 } from "uuid";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ackInstanceInboxMock,
  getEnvMock,
  getInstanceInboxMock,
  orchestratorFindManyMock,
  orchestratorFindFirstMock,
  orchestratorUpdateManyMock,
  hermesMessageUpsertMock,
} = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  getInstanceInboxMock: vi.fn(),
  ackInstanceInboxMock: vi.fn(),
  orchestratorFindManyMock: vi.fn(),
  orchestratorFindFirstMock: vi.fn(),
  orchestratorUpdateManyMock: vi.fn(),
  hermesMessageUpsertMock: vi.fn(),
}));

const HERMES_INBOX_MESSAGE_UUID_NAMESPACE =
  "3ed84820-2c89-4546-9a58-96b20f8b4980";

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => getEnvMock(),
}));

vi.mock("@/clients/hermes-orchestrator.client", () => ({
  getInstanceInbox: (...args: unknown[]) => getInstanceInboxMock(...args),
  ackInstanceInbox: (...args: unknown[]) => ackInstanceInboxMock(...args),
  HermesOrchestratorError: class HermesOrchestratorError extends Error {},
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    orchestrator: {
      findMany: (...args: unknown[]) => orchestratorFindManyMock(...args),
      findFirst: (...args: unknown[]) => orchestratorFindFirstMock(...args),
      updateMany: (...args: unknown[]) => orchestratorUpdateManyMock(...args),
    },
    $transaction: async (
      arg:
        | Array<Promise<unknown>>
        | ((tx: {
            hermesMessage: { upsert: typeof hermesMessageUpsertMock };
          }) => Promise<unknown>),
    ) => {
      if (Array.isArray(arg)) return await Promise.all(arg);
      return await arg({
        hermesMessage: { upsert: hermesMessageUpsertMock },
      });
    },
  },
}));

import { hermesInboxSyncService } from "./hermes-inbox-sync.service";

describe("hermesInboxSyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      HERMES_INBOX_POLLING_ENABLED: true,
    } as ReturnType<typeof import("@/config/env").getEnv>);
    ackInstanceInboxMock.mockResolvedValue({ kind: "ok" });
    hermesMessageUpsertMock.mockResolvedValue(undefined);
    orchestratorUpdateManyMock.mockResolvedValue(undefined);
  });

  it("sets lastInboxMessageAt to the max createdAt, not the last array element", async () => {
    orchestratorFindManyMock.mockResolvedValue([
      {
        userId: "user-inbox-1",
        lastInboxMessageAt: null,
        lastPolledAt: null,
      },
    ]);

    getInstanceInboxMock.mockResolvedValue({
      kind: "messages",
      data: {
        messages: [
          {
            id: "m-early",
            content: "oldest",
            createdAt: "2026-01-01T10:00:00.000Z",
          },
          {
            id: "m-latest",
            content: "newest",
            createdAt: "2026-01-01T14:00:00.000Z",
          },
          {
            id: "m-mid",
            content: "middle",
            createdAt: "2026-01-01T12:00:00.000Z",
          },
        ],
        hasMore: false,
      },
    });

    const abortController = new AbortController();
    await hermesInboxSyncService.pollInboxes({
      abortSignal: abortController.signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(orchestratorUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-inbox-1", archivedAt: null },
        data: expect.objectContaining({
          lastInboxMessageAt: new Date("2026-01-01T14:00:00.000Z"),
          lastPolledAt: expect.any(Date),
        }),
      }),
    );
  });

  it("does not start the next inbox poll after shouldContinue becomes false", async () => {
    orchestratorFindManyMock.mockResolvedValue([
      {
        userId: "user-first",
        lastInboxMessageAt: null,
        lastPolledAt: null,
      },
      {
        userId: "user-second",
        lastInboxMessageAt: null,
        lastPolledAt: null,
      },
    ]);

    let allowContinue = true;
    getInstanceInboxMock.mockImplementation(async () => {
      allowContinue = false;
      return { kind: "not_implemented" as const };
    });

    const summary = await hermesInboxSyncService.pollInboxes({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => allowContinue,
    });

    expect(getInstanceInboxMock).toHaveBeenCalledTimes(1);
    expect(getInstanceInboxMock).toHaveBeenCalledWith(
      "user-first",
      expect.any(Object),
    );
    expect(summary.polled).toBe(1);
    expect(summary.breakdown.skipped_not_implemented).toBe(1);
  });

  it("overlaps the inbox since cursor when lastInboxMessageAt is set", async () => {
    orchestratorFindManyMock.mockResolvedValue([
      {
        userId: "user-overlap",
        lastInboxMessageAt: new Date("2026-01-01T10:00:00.000Z"),
        lastPolledAt: null,
      },
    ]);

    getInstanceInboxMock.mockResolvedValue({
      kind: "messages",
      data: { messages: [], hasMore: false },
    });

    await hermesInboxSyncService.pollInboxes({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(getInstanceInboxMock).toHaveBeenCalledWith(
      "user-overlap",
      expect.objectContaining({
        sinceIso: "2026-01-01T09:55:00.000Z",
      }),
    );
  });

  it("does not advance lastInboxMessageAt when inbox ack fails", async () => {
    orchestratorFindManyMock.mockResolvedValue([
      {
        userId: "user-ack-fails",
        lastInboxMessageAt: null,
        lastPolledAt: null,
      },
    ]);
    getInstanceInboxMock.mockResolvedValue({
      kind: "messages",
      data: {
        messages: [
          {
            id: "m-unacked",
            content: "retry me",
            createdAt: "2026-01-01T10:00:00.000Z",
          },
        ],
        hasMore: false,
      },
    });
    ackInstanceInboxMock.mockRejectedValue(new Error("ack failed"));

    await hermesInboxSyncService.pollInboxes({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    const ackFailureUpdates = orchestratorUpdateManyMock.mock.calls.filter(
      ([args]) =>
        (args as { where?: { userId?: string } }).where?.userId ===
        "user-ack-fails",
    );
    expect(ackFailureUpdates).not.toHaveLength(0);
    expect(
      ackFailureUpdates.some(
        ([args]) =>
          "lastInboxMessageAt" in
          ((args as { data?: Record<string, unknown> }).data ?? {}),
      ),
    ).toBe(false);
  });

  it("upserts inbox messages with a stable id derived from the orchestrator message id", async () => {
    orchestratorFindManyMock.mockResolvedValue([
      {
        userId: "user-upsert",
        lastInboxMessageAt: null,
        lastPolledAt: null,
      },
    ]);
    getInstanceInboxMock.mockResolvedValue({
      kind: "messages",
      data: {
        messages: [
          {
            id: "orchestrator-message-1",
            content: "timeout notice",
            createdAt: "2026-01-01T10:00:00.000Z",
            kind: "text",
          },
        ],
        hasMore: false,
      },
    });

    await hermesInboxSyncService.pollInboxes({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    const expectedId = uuidv5(
      "user-upsert:orchestrator-message-1",
      HERMES_INBOX_MESSAGE_UUID_NAMESPACE,
    );
    expect(hermesMessageUpsertMock).toHaveBeenCalledWith({
      where: { id: expectedId },
      create: expect.objectContaining({
        id: expectedId,
        userId: "user-upsert",
        role: "assistant",
        content: "timeout notice",
        kind: "text",
        createdAt: new Date("2026-01-01T10:00:00.000Z"),
      }),
      update: {},
    });
  });

  it("suppresses Sentry for due-query schema drift during migrate windows", async () => {
    const schemaDriftError = Object.assign(
      new Error(
        "The table `public.hermesInstance` does not exist in the current database.",
      ),
      {
        name: "PrismaClientKnownRequestError",
        code: "P2021",
      },
    );
    orchestratorFindManyMock.mockRejectedValue(schemaDriftError);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const summary = await hermesInboxSyncService.pollInboxes({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(summary.polled).toBe(0);
    expect(summary.breakdown.error).toBe(1);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[hermes_inbox_query] suppressed external failure",
      expect.objectContaining({
        error: schemaDriftError.message,
      }),
    );

    consoleErrorSpy.mockRestore();
  });

  it("reports unexpected due-query failures to Sentry with hermes_inbox_query context", async () => {
    const queryError = new Error("connection pool exhausted");
    orchestratorFindManyMock.mockRejectedValue(queryError);

    const summary = await hermesInboxSyncService.pollInboxes({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(summary.polled).toBe(0);
    expect(summary.breakdown.error).toBe(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      queryError,
      expect.objectContaining({
        tags: { context: "hermes_inbox_query" },
      }),
    );
  });

  it("reports unexpected pollOne failures to Sentry with hermes_inbox_unhandled context", async () => {
    orchestratorFindManyMock.mockResolvedValue([
      {
        userId: "user-unhandled",
        lastInboxMessageAt: null,
        lastPolledAt: null,
      },
    ]);

    getInstanceInboxMock.mockResolvedValue({
      kind: "messages",
      data: undefined,
    } as never);

    const summary = await hermesInboxSyncService.pollInboxes({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(summary.polled).toBe(1);
    expect(summary.breakdown.error).toBe(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(TypeError),
      expect.objectContaining({
        tags: { context: "hermes_inbox_unhandled" },
        extra: { userId: "user-unhandled" },
      }),
    );
  });

  it("escalates a single aggregate outage event when transient failures dominate the batch", async () => {
    const instances = Array.from({ length: 6 }, (_, i) => ({
      userId: `user-outage-${i}`,
      lastInboxMessageAt: null,
      lastPolledAt: null,
    }));
    orchestratorFindManyMock.mockResolvedValue(instances);

    const transientError = Object.assign(new TypeError("fetch failed"), {
      cause: new Error("connect timeout"),
    });
    getInstanceInboxMock.mockRejectedValue(transientError);

    const summary = await hermesInboxSyncService.pollInboxes({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(summary.breakdown.error).toBe(6);
    // Per-user transient failures stay muted — they're aggregated, not paged
    // once per affected user.
    expect(Sentry.captureException).not.toHaveBeenCalled();
    // One aggregate outage event, on its own fingerprint so it never re-groups
    // under the raw HermesOrchestratorError (SOKOSUMI-CORE-1M).
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "hermes_inbox_orchestrator_outage",
      expect.objectContaining({
        level: "error",
        fingerprint: ["hermes-inbox-orchestrator-outage"],
        tags: { context: "hermes_inbox_poll_batch" },
        extra: expect.objectContaining({
          transientErrorCount: 6,
          polled: 6,
          sampleError: "fetch failed",
        }),
      }),
    );
  });

  it("does not archive on instance_missing (fail-open like GET /me/instance)", async () => {
    orchestratorFindManyMock.mockResolvedValue([
      {
        userId: "user-missing",
        lastInboxMessageAt: null,
        lastPolledAt: null,
      },
    ]);
    getInstanceInboxMock.mockResolvedValue({ kind: "instance_missing" });

    const summary = await hermesInboxSyncService.pollInboxes({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(summary.breakdown.skipped_instance_missing).toBe(1);
    expect(orchestratorUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-missing", archivedAt: null },
        data: expect.objectContaining({
          lastPolledAt: expect.any(Date),
          consecutivePollErrors: 0,
        }),
      }),
    );
    const archiveCalls = orchestratorUpdateManyMock.mock.calls.filter(
      ([args]) =>
        (args as { data?: { archivedAt?: unknown } }).data?.archivedAt != null,
    );
    expect(archiveCalls).toHaveLength(0);
  });

  it("does not alert when a transient failure is isolated among healthy polls", async () => {
    const instances = Array.from({ length: 6 }, (_, i) => ({
      userId: `user-blip-${i}`,
      lastInboxMessageAt: null,
      lastPolledAt: null,
    }));
    orchestratorFindManyMock.mockResolvedValue(instances);

    const transientError = Object.assign(new TypeError("fetch failed"), {
      cause: new Error("connect timeout"),
    });
    let call = 0;
    getInstanceInboxMock.mockImplementation(async () => {
      call += 1;
      if (call === 1) throw transientError;
      return {
        kind: "messages" as const,
        data: { messages: [], hasMore: false },
      };
    });

    const summary = await hermesInboxSyncService.pollInboxes({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      shouldContinue: () => true,
    });

    expect(summary.breakdown.error).toBe(1);
    expect(summary.breakdown.no_messages).toBe(5);
    // A lone self-healing 502/timeout must not page anyone.
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
