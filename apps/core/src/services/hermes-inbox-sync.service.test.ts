import * as Sentry from "@sentry/node";
import { v5 as uuidv5 } from "uuid";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ackInstanceInboxMock,
  getEnvMock,
  getInstanceInboxMock,
  hermesInstanceFindManyMock,
  hermesInstanceFindUniqueMock,
  hermesInstanceUpdateMock,
  hermesMessageUpsertMock,
} = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  getInstanceInboxMock: vi.fn(),
  ackInstanceInboxMock: vi.fn(),
  hermesInstanceFindManyMock: vi.fn(),
  hermesInstanceFindUniqueMock: vi.fn(),
  hermesInstanceUpdateMock: vi.fn(),
  hermesMessageUpsertMock: vi.fn(),
}));

const HERMES_INBOX_MESSAGE_UUID_NAMESPACE =
  "3ed84820-2c89-4546-9a58-96b20f8b4980";

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
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
    hermesInstance: {
      findMany: (...args: unknown[]) => hermesInstanceFindManyMock(...args),
      findUnique: (...args: unknown[]) => hermesInstanceFindUniqueMock(...args),
      update: (...args: unknown[]) => hermesInstanceUpdateMock(...args),
      delete: vi.fn().mockResolvedValue(undefined),
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
    hermesInstanceUpdateMock.mockResolvedValue(undefined);
  });

  it("sets lastInboxMessageAt to the max createdAt, not the last array element", async () => {
    hermesInstanceFindManyMock.mockResolvedValue([
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

    expect(hermesInstanceUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-inbox-1" },
        data: expect.objectContaining({
          lastInboxMessageAt: new Date("2026-01-01T14:00:00.000Z"),
          lastPolledAt: expect.any(Date),
        }),
      }),
    );
  });

  it("does not start the next inbox poll after shouldContinue becomes false", async () => {
    hermesInstanceFindManyMock.mockResolvedValue([
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
    hermesInstanceFindManyMock.mockResolvedValue([
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
    hermesInstanceFindManyMock.mockResolvedValue([
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

    const ackFailureUpdates = hermesInstanceUpdateMock.mock.calls.filter(
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
    hermesInstanceFindManyMock.mockResolvedValue([
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

  it("reports unexpected pollOne failures to Sentry with hermes_inbox_unhandled context", async () => {
    hermesInstanceFindManyMock.mockResolvedValue([
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
});
