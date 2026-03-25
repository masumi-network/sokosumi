import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPendingAndSetPrevious,
  persistPendingResponseId,
} from "./persist-pending-response-id";

const { prismaTransactionMock } = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
}));

interface TestTx {
  $queryRaw: ReturnType<typeof vi.fn>;
  conversation: {
    update: ReturnType<typeof vi.fn>;
  };
}

function createTxWithMetadata(metadata: Record<string, unknown>): TestTx {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ metadata }]),
    conversation: {
      update: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("persistPendingResponseId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores pending response id with coworker metadata", async () => {
    const tx = createTxWithMetadata({ previous_response_id: "resp_old" });
    prismaTransactionMock.mockImplementationOnce(
      async (callback: (txClient: TestTx) => Promise<void>) => callback(tx),
    );

    await persistPendingResponseId(
      {
        conversationId: "conv_123",
        userId: "user_123",
        responseId: "resp_new",
        coworkerSlug: "ops-agent",
        coworkerId: "cow_123",
      },
      {
        maxAttempts: 1,
      },
    );

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.conversation.update).toHaveBeenCalledWith({
      where: { id: "conv_123" },
      data: {
        metadata: {
          previous_response_id: "resp_old",
          pending_responses_api_response_id: "resp_new",
          coworker_slug: "ops-agent",
          coworker_id: "cow_123",
        },
      },
    });
  });

  it("does not update metadata when response id is already previous", async () => {
    const tx = createTxWithMetadata({ previous_response_id: "resp_same" });
    prismaTransactionMock.mockImplementationOnce(
      async (callback: (txClient: TestTx) => Promise<void>) => callback(tx),
    );

    await persistPendingResponseId(
      {
        conversationId: "conv_123",
        userId: "user_123",
        responseId: "resp_same",
        coworkerSlug: "ops-agent",
        coworkerId: "cow_123",
      },
      {
        maxAttempts: 1,
      },
    );

    expect(tx.conversation.update).not.toHaveBeenCalled();
  });

  it("retries transaction failures until success", async () => {
    const tx = createTxWithMetadata({});
    prismaTransactionMock
      .mockRejectedValueOnce(new Error("deadlock"))
      .mockImplementationOnce(
        async (callback: (txClient: TestTx) => Promise<void>) => callback(tx),
      );

    await persistPendingResponseId(
      {
        conversationId: "conv_123",
        userId: "user_123",
        responseId: "resp_retry",
        coworkerSlug: "ops-agent",
        coworkerId: "cow_123",
      },
      {
        maxAttempts: 2,
        delaysMs: [0],
      },
    );

    expect(prismaTransactionMock).toHaveBeenCalledTimes(2);
    expect(tx.conversation.update).toHaveBeenCalledTimes(1);
  });
});

describe("clearPendingAndSetPrevious", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears pending id and sets previous id", async () => {
    const tx = createTxWithMetadata({
      pending_responses_api_response_id: "resp_pending",
      coworker_slug: "ops-agent",
      coworker_id: "cow_123",
    });
    prismaTransactionMock.mockImplementationOnce(
      async (callback: (txClient: TestTx) => Promise<void>) => callback(tx),
    );

    await clearPendingAndSetPrevious(
      {
        conversationId: "conv_123",
        userId: "user_123",
        responseId: "resp_done",
      },
      {
        maxAttempts: 1,
      },
    );

    expect(tx.conversation.update).toHaveBeenCalledWith({
      where: { id: "conv_123" },
      data: {
        metadata: {
          pending_responses_api_response_id: null,
          coworker_slug: "ops-agent",
          coworker_id: "cow_123",
          previous_response_id: "resp_done",
        },
      },
    });
  });

  it("throws after exhausting retries", async () => {
    prismaTransactionMock.mockRejectedValue(new Error("db unavailable"));

    await expect(
      clearPendingAndSetPrevious(
        {
          conversationId: "conv_123",
          userId: "user_123",
          responseId: "resp_done",
        },
        {
          maxAttempts: 2,
          delaysMs: [0],
        },
      ),
    ).rejects.toThrow("db unavailable");

    expect(prismaTransactionMock).toHaveBeenCalledTimes(2);
  });
});
