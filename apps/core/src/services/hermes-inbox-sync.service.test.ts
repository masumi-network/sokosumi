import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ackInstanceInboxMock,
  getEnvMock,
  getInstanceInboxMock,
  hermesInstanceFindManyMock,
  hermesInstanceUpdateMock,
  hermesMessageCreateMock,
} = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  getInstanceInboxMock: vi.fn(),
  ackInstanceInboxMock: vi.fn(),
  hermesInstanceFindManyMock: vi.fn(),
  hermesInstanceUpdateMock: vi.fn(),
  hermesMessageCreateMock: vi.fn(),
}));

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
      update: (...args: unknown[]) => hermesInstanceUpdateMock(...args),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    $transaction: async (
      arg:
        | Array<Promise<unknown>>
        | ((tx: {
            hermesMessage: { create: typeof hermesMessageCreateMock };
          }) => Promise<unknown>),
    ) => {
      if (Array.isArray(arg)) return await Promise.all(arg);
      return await arg({
        hermesMessage: { create: hermesMessageCreateMock },
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
    hermesMessageCreateMock.mockResolvedValue(undefined);
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
});
