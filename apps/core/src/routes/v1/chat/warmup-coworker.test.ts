import { COWORKER_AGENT_ERROR_SNIPPET } from "@sokosumi/ai-provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  coworkerReadyRedisKey,
  MAX_WARMUP_ATTEMPTS,
  readCoworkerReadyState,
  setCoworkerReadyState,
  warmupCoworkerConversation,
} from "./warmup-coworker";

const {
  conversationFindFirstMock,
  conversationUpdateMock,
  queryRawMock,
  transactionMock,
  getRedisClientMock,
  redisGetMock,
  redisSetMock,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  conversationUpdateMock: vi.fn(),
  queryRawMock: vi.fn(),
  transactionMock: vi.fn(),
  getRedisClientMock: vi.fn(),
  redisGetMock: vi.fn(),
  redisSetMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    conversation: {
      findFirst: conversationFindFirstMock,
      update: conversationUpdateMock,
    },
    $transaction: transactionMock,
  },
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: getRedisClientMock,
}));

const fetchMock = vi.fn();

const DEFAULT_OPTIONS = {
  internalConversationId: "conv-internal-1",
  userId: "user_1",
  organizationId: "org_1",
  coworkerSlug: "elena",
  responsesApiBaseUrl: "https://api.coworker.example.com/v1",
};

const DEFAULT_PROVIDER_CONVERSATION_ID = "conv_remote_warmup";

function goodSseBody(text: string): string {
  return `data: {"type":"response.output_text.delta","delta":"${text}"}\n\n`;
}

function agentErrorSseBody(): string {
  return goodSseBody(`${COWORKER_AGENT_ERROR_SNIPPET}. Please try again.`);
}

function shortTailSseBody(): string {
  return goodSseBody("Done");
}

function sseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function mockConversationMetadata(metadata: Record<string, unknown>): void {
  queryRawMock.mockResolvedValue([{ metadata }]);
  conversationUpdateMock.mockResolvedValue({});
}

describe("warmup-coworker", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    conversationFindFirstMock.mockResolvedValue({
      providerConversationId: DEFAULT_PROVIDER_CONVERSATION_ID,
    });
    mockConversationMetadata({ coworker: "Elena" });
    transactionMock.mockImplementation(async (callback) =>
      callback({
        $queryRaw: queryRawMock,
        conversation: {
          update: conversationUpdateMock,
        },
      }),
    );
    getRedisClientMock.mockReturnValue({
      get: redisGetMock,
      set: redisSetMock,
    });
    redisGetMock.mockResolvedValue(null);
    redisSetMock.mockResolvedValue("OK");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("marks ready on first successful warmup attempt", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(
        goodSseBody("Warmup succeeded with enough output text for success."),
      ),
    );

    await warmupCoworkerConversation(DEFAULT_OPTIONS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, fetchInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(fetchInit.body))).toEqual({
      input: expect.any(Array),
      stream: true,
      conversation: DEFAULT_PROVIDER_CONVERSATION_ID,
    });
    expect(redisSetMock).toHaveBeenCalledWith(
      coworkerReadyRedisKey(DEFAULT_OPTIONS.internalConversationId),
      "pending",
      "EX",
      120,
    );
    expect(redisSetMock).toHaveBeenCalledWith(
      coworkerReadyRedisKey(DEFAULT_OPTIONS.internalConversationId),
      "ready",
      "EX",
      120,
    );
    expect(conversationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            warmup_attempts: 1,
            warmup_state: "ready",
          }),
        }),
      }),
    );
  });

  it("retries after agent error and succeeds within five attempts", async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse(agentErrorSseBody()))
      .mockResolvedValueOnce(
        sseResponse(
          goodSseBody("Recovered after agent error with enough text."),
        ),
      );

    await warmupCoworkerConversation(DEFAULT_OPTIONS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(redisSetMock).toHaveBeenCalledWith(
      coworkerReadyRedisKey(DEFAULT_OPTIONS.internalConversationId),
      "ready",
      "EX",
      120,
    );
  });

  it("retries after short-tail output", async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse(shortTailSseBody()))
      .mockResolvedValueOnce(
        sseResponse(
          goodSseBody("Now the coworker returns a sufficiently long reply."),
        ),
      );

    await warmupCoworkerConversation(DEFAULT_OPTIONS);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(redisSetMock).toHaveBeenCalledWith(
      coworkerReadyRedisKey(DEFAULT_OPTIONS.internalConversationId),
      "ready",
      "EX",
      120,
    );
  });

  it("marks failed after five unsuccessful attempts", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => sseResponse(agentErrorSseBody()));

    const warmupPromise = warmupCoworkerConversation(DEFAULT_OPTIONS);
    await vi.runAllTimersAsync();
    await warmupPromise;
    vi.useRealTimers();

    expect(fetchMock).toHaveBeenCalledTimes(MAX_WARMUP_ATTEMPTS);
    expect(redisSetMock).toHaveBeenCalledWith(
      coworkerReadyRedisKey(DEFAULT_OPTIONS.internalConversationId),
      "failed",
      "EX",
      120,
    );
    expect(conversationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            warmup_attempts: MAX_WARMUP_ATTEMPTS,
            warmup_state: "failed",
            warmup_completed_at: expect.any(String),
          }),
        }),
      }),
    );
  });

  it("marks failed when provider conversation id is missing", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      providerConversationId: null,
    });

    await warmupCoworkerConversation(DEFAULT_OPTIONS);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(redisSetMock).toHaveBeenCalledWith(
      coworkerReadyRedisKey(DEFAULT_OPTIONS.internalConversationId),
      "failed",
      "EX",
      120,
    );
  });

  it("writes metadata only when Redis is unavailable and does not throw", async () => {
    getRedisClientMock.mockReturnValue(null);
    fetchMock.mockResolvedValueOnce(
      sseResponse(
        goodSseBody("Metadata-only warmup path still succeeds cleanly."),
      ),
    );

    await expect(
      warmupCoworkerConversation(DEFAULT_OPTIONS),
    ).resolves.toBeUndefined();

    expect(redisSetMock).not.toHaveBeenCalled();
    expect(conversationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            coworker: "Elena",
            warmup_attempts: 1,
            warmup_state: "ready",
          }),
        }),
      }),
    );
  });

  it("reads Redis state before metadata", async () => {
    redisGetMock.mockResolvedValueOnce("ready");

    const result = await readCoworkerReadyState(
      DEFAULT_OPTIONS.internalConversationId,
      {
        warmup_state: "failed",
        warmup_completed_at: "2025-01-01T00:00:00.000Z",
      },
    );

    expect(result).toEqual({
      state: "ready",
      completedAt: "2025-01-01T00:00:00.000Z",
      attempts: null,
      source: "redis",
    });
  });

  it("prefers terminal metadata over stale Redis pending", async () => {
    redisGetMock.mockResolvedValueOnce("pending");

    const result = await readCoworkerReadyState(
      DEFAULT_OPTIONS.internalConversationId,
      {
        warmup_state: "ready",
        warmup_completed_at: "2025-01-01T00:00:00.000Z",
        warmup_attempts: 2,
      },
    );

    expect(result).toEqual({
      state: "ready",
      completedAt: "2025-01-01T00:00:00.000Z",
      attempts: 2,
      source: "metadata",
    });
  });

  it("falls back to metadata when Redis misses", async () => {
    const result = await readCoworkerReadyState(
      DEFAULT_OPTIONS.internalConversationId,
      {
        warmup_state: "ready",
        warmup_completed_at: "2025-01-01T00:00:00.000Z",
        warmup_attempts: 3,
      },
    );

    expect(result).toEqual({
      state: "ready",
      completedAt: "2025-01-01T00:00:00.000Z",
      attempts: 3,
      source: "metadata",
    });
  });

  it("preserves existing metadata keys when setting ready state", async () => {
    await setCoworkerReadyState(
      DEFAULT_OPTIONS.internalConversationId,
      DEFAULT_OPTIONS.userId,
      "pending",
    );

    expect(conversationUpdateMock).toHaveBeenCalledWith({
      where: {
        id: DEFAULT_OPTIONS.internalConversationId,
      },
      data: {
        metadata: {
          coworker: "Elena",
          warmup_state: "pending",
        },
      },
    });
  });
});
