import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getRedisClientMock, redisEvalMock } = vi.hoisted(() => ({
  getRedisClientMock: vi.fn(),
  redisEvalMock: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: getRedisClientMock,
}));

import { LIMITS } from "@/config/constants";

import {
  assertChatMessageReadBudget,
  chatMessageReadBudgetRedisKey,
} from "./chat-message-read-budget";

describe("chat-message-read-budget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRedisClientMock.mockReturnValue({ eval: redisEvalMock });
    redisEvalMock.mockResolvedValue([1, 0]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keys the budget by user id only, so rooms and credentials share it", () => {
    expect(chatMessageReadBudgetRedisKey("user-1")).toBe(
      "chat:message-read-budget:user-1",
    );
  });

  it("allows the read when the bucket has tokens", async () => {
    await expect(
      assertChatMessageReadBudget("user-1", new Date(1_000)),
    ).resolves.toBeUndefined();

    expect(redisEvalMock).toHaveBeenCalledTimes(1);
    const [script, keyCount, key, capacity, refillPerSecond, nowMs] =
      redisEvalMock.mock.calls[0] ?? [];
    expect(typeof script).toBe("string");
    expect(script).toContain("tokens");
    expect(keyCount).toBe(1);
    expect(key).toBe("chat:message-read-budget:user-1");
    expect(capacity).toBe(LIMITS.CHAT_MESSAGE_READ_BURST);
    expect(refillPerSecond).toBe(LIMITS.CHAT_MESSAGE_READ_REFILL_PER_SECOND);
    expect(nowMs).toBe(1_000);
  });

  it("throws 429 with kind and retry delay when the bucket is empty", async () => {
    redisEvalMock.mockResolvedValue([0, 7]);

    const error = await assertChatMessageReadBudget("user-1").catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(HTTPException);
    const httpError = error as HTTPException;
    expect(httpError.status).toBe(429);
    expect(httpError.cause).toMatchObject({
      kind: "message_read_budget_exceeded",
      retryAfterSeconds: 7,
    });
  });

  it("resolves without redis (local/dev fail-open)", async () => {
    getRedisClientMock.mockReturnValue(null);

    await expect(
      assertChatMessageReadBudget("user-1"),
    ).resolves.toBeUndefined();
    expect(redisEvalMock).not.toHaveBeenCalled();
  });

  it("resolves when redis fails (outage fail-open, reads stay available)", async () => {
    redisEvalMock.mockRejectedValue(new Error("redis down"));

    await expect(
      assertChatMessageReadBudget("user-1"),
    ).resolves.toBeUndefined();
  });
});
